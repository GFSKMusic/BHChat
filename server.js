const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const Database = require('better-sqlite3');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });
const rooms = {};

// Initialize the database
const db = new Database('chat.db', { verbose: console.log });

// Create tables if they don't exist
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room TEXT,
        sender_id TEXT,
        sender_username TEXT,
        type TEXT,
        content TEXT,
        timestamp TEXT
    )
`).run();

console.log('Database initialized successfully.');

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

    ws.on('message', async message => {
        const data = JSON.parse(message);
        data.sender = ws.id;

        switch (data.type) {
            case 'register':
                try {
                    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(data.username, data.password);
                    ws.send(JSON.stringify({ type: 'registration_success' }));
                } catch (err) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Username already exists.' }));
                }
                break;

            case 'login':
                const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(data.username, data.password);
                if (user) {
                    ws.send(JSON.stringify({ type: 'login_success', username: user.username }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid username or password.' }));
                }
                break;

            case 'join_room':
                if (!data.username || data.username.trim() === '') {
                    ws.send(JSON.stringify({ type: 'error', message: 'Username is required.' }));
                    return;
                }
                
                if (ws.room && rooms[ws.room]) {
                    const oldRoomPeers = rooms[ws.room];
                    const updatedPeers = oldRoomPeers.filter(client => client.id !== ws.id);
                    rooms[ws.room] = updatedPeers;
                    
                    if (updatedPeers.length === 0) {
                        delete rooms[ws.room];
                    } else {
                        updatedPeers.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'peer_left',
                                    peerId: ws.id,
                                }));
                            }
                        });
                    }
                }

                if (!rooms[data.room]) {
                    rooms[data.room] = [];
                }
                
                ws.username = data.username;
                rooms[data.room].push(ws);
                ws.room = data.room;
                
                console.log(`Peer ${ws.id} (${ws.username}) joined room '${data.room}'. Total peers: ${rooms[data.room].length}`);
                
                // Retrieve chat history from the database
                const history = db.prepare('SELECT sender_username as sender, type, content, timestamp FROM messages WHERE room = ? ORDER BY timestamp ASC').all(data.room);
                ws.send(JSON.stringify({
                    type: 'chat_history',
                    history: history
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
                
                db.prepare('INSERT INTO messages (room, sender_id, sender_username, type, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(data.room, ws.id, ws.username, chatMessage.type, chatMessage.text, chatMessage.timestamp);
                
                rooms[data.room].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
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
                
                db.prepare('INSERT INTO messages (room, sender_id, sender_username, type, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(data.room, ws.id, ws.username, imageMessage.type, imageMessage.image, imageMessage.timestamp);
                
                rooms[data.room].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'image_message',
                            message: imageMessage
                        }));
                    }
                });
                break;

            case 'new_dm_message':
                const dmMessage = {
                    ...data.message,
                    senderId: ws.id
                };
                const targetClient = rooms[ws.room].find(client => client.id === data.target);
                
                if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                    targetClient.send(JSON.stringify({ type: 'dm_message', message: dmMessage }));
                    ws.send(JSON.stringify({ type: 'dm_message', message: dmMessage }));
                }
                break;

            case 'get_online_users':
                const onlineUsers = {};
                if (rooms[data.room]) {
                    rooms[data.room].forEach(client => {
                        onlineUsers[client.id] = { username: client.username };
                    });
                }
                ws.send(JSON.stringify({
                    type: 'online_users_list',
                    users: onlineUsers
                }));
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
            
            case 'offer':
            case 'answer':
            case 'candidate':
                const targetPeer = rooms[data.room].find(client => client.id === data.targetPeer);
                if (targetPeer && targetPeer.readyState === WebSocket.OPEN) {
                    targetPeer.send(JSON.stringify(data.description ? { ...data, description: data.description, username: ws.username } : data));
                }
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
            }
        }
    });
});
