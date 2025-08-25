const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });
const rooms = {};
const roomMessages = {};

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if ('IPv4' !== iface.family || iface.internal !== false) {
                continue;
            }
            return iface.address;
        }
    }
}

const localIp = getLocalIpAddress();

console.log(`Signaling server started on port ${PORT}`);
if (localIp) {
    console.log(`WebSocket URL (Local Network): ws://${localIp}:${PORT}`);
} else {
    console.log('Could not find a local IP address. The server may not be accessible from other devices.');
}

wss.on('connection', ws => {
    ws.id = uuidv4();
    console.log(`Client connected with ID: ${ws.id}`);

    ws.on('message', message => {
        const data = JSON.parse(message);
        data.sender = ws.id;

        switch (data.type) {
            case 'join_room':
                if (!data.username || data.username.trim() === '') {
                    ws.send(JSON.stringify({ type: 'error', message: 'Username is required.' }));
                    return;
                }
                
                if (!rooms[data.room]) {
                    rooms[data.room] = [];
                }
                if (!roomMessages[data.room]) {
                    roomMessages[data.room] = [];
                }
                
                ws.username = data.username;
                rooms[data.room].push(ws);
                ws.room = data.room;
                
                console.log(`Peer ${ws.id} (${ws.username}) joined room '${data.room}'. Total peers: ${rooms[data.room].length}`);
                
                ws.send(JSON.stringify({
                    type: 'chat_history',
                    history: roomMessages[data.room]
                }));

                rooms[data.room].forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'peer_joined',
                            peerId: ws.id,
                            username: ws.username,
                        }));
                    }
                });

                rooms[data.room].forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'peer_joined',
                            peerId: client.id,
                            username: client.username,
                        }));
                    }
                });
                
                ws.send(JSON.stringify({
                    type: 'room_joined',
                    peerId: ws.id,
                    username: ws.username,
                }));
                break;
            
            case 'new_chat_message':
                const chatMessage = {
                    type: 'text',
                    senderId: ws.id,
                    sender: ws.username,
                    text: data.message,
                    timestamp: new Date().toISOString()
                };
                roomMessages[data.room].push(chatMessage);
                
                rooms[data.room].forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'chat_message',
                            message: chatMessage
                        }));
                    }
                });
                break;

            case 'new_image_message':
                const imageMessage = {
                    type: 'image',
                    senderId: ws.id,
                    sender: ws.username,
                    image: data.image,
                    timestamp: new Date().toISOString()
                };
                roomMessages[data.room].push(imageMessage);
                
                rooms[data.room].forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'image_message',
                            message: imageMessage
                        }));
                    }
                });
                break;

            case 'offer':
            case 'answer':
            case 'candidate':
                const targetPeer = rooms[data.room].find(client => client.id === data.targetPeer);
                if (targetPeer && targetPeer.readyState === WebSocket.OPEN) {
                    targetPeer.send(JSON.stringify(data.description ? { ...data, description: data.description, username: ws.username } : data));
                }
                break;
            
            case 'get_active_rooms':
                const activeRooms = {};
                for (const roomName in rooms) {
                    if (rooms[roomName].length > 0) {
                        activeRooms[roomName] = {
                            count: rooms[roomName].length,
                            users: rooms[roomName].map(client => client.username)
                        };
                    }
                }
                ws.send(JSON.stringify({
                    type: 'active_rooms_list',
                    rooms: activeRooms
                }));
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Client ${ws.id} (${ws.username}) disconnected.`);
        if (ws.room && rooms[ws.room]) {
            const roomPeers = rooms[ws.room];
            const updatedPeers = roomPeers.filter(client => client.id !== ws.id);
            
            updatedPeers.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'peer_left',
                        peerId: ws.id,
                    }));
                }
            });

            if (updatedPeers.length > 0) {
                rooms[ws.room] = updatedPeers;
            } else {
                delete rooms[ws.room];
                delete roomMessages[ws.room];
            }
        }
    });
});
