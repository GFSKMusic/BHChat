// THIS IS OUTDATED AND OBSOLETE! ONLY HERE FOR ARCHIVAL!!

const authSection = document.getElementById('auth-section');
const mainApp = document.getElementById('main-app');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');
const loginButton = document.getElementById('login-button');
const registerButton = document.getElementById('register-button');
const authStatus = document.getElementById('auth-status');
const togglePassword = document.getElementById('toggle-password'); // New element

const videoGrid = document.getElementById('video-grid');
const chatbox = document.getElementById('chatbox');
const chatInput = document.getElementById('chat-input');
const chatInputForm = document.getElementById('chat-input-form');
const roomInput = document.getElementById('room-input');
const joinButton = document.getElementById('join-button');
const statusMessage = document.getElementById('status-message');
const mediaControls = document.getElementById('media-controls');
const callButton = document.getElementById('call-button');
const hangupButton = document.getElementById('hangup-button');
const imageInput = document.getElementById('image-input');
const uploadImageButton = document.getElementById('upload-image-button');
const activeRoomsList = document.getElementById('active-rooms-list');
const refreshRoomsButton = document.getElementById('refresh-rooms-button');
const onlineUsersList = document.getElementById('online-users-list');
const chatTitle = document.getElementById('chat-title');

let localStream;
let localPeerId;
let localUsername;
let roomName;
const peerConnections = {};
const peerUsernames = {};
const dataChannels = {};
let currentChatTarget = 'room';
const dmHistory = {};
let userListInterval;

const signalingServerUrl = 'wss://bhchat.onrender.com';
let ws;

const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// New Event Listener for the password toggle
togglePassword.addEventListener('click', function() {
    // Toggle the type attribute
    const type = authPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    authPasswordInput.setAttribute('type', type);
    
    // Toggle the text content of the span
    this.textContent = type === 'password' ? 'Show' : 'Hide';
});

loginButton.onclick = () => {
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value.trim();
    if (username && password) {
        authStatus.textContent = 'Logging in...';
        ws.send(JSON.stringify({ type: 'login', username, password }));
    } else {
        authStatus.textContent = 'Please enter both username and password.';
    }
};

registerButton.onclick = () => {
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value.trim();
    if (username && password) {
        authStatus.textContent = 'Registering user...';
        ws.send(JSON.stringify({ type: 'register', username, password }));
    } else {
        authStatus.textContent = 'Please enter both username and password.';
    }
};

callButton.onclick = async () => {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addLocalVideoElement();
        for (const peerId in peerConnections) {
            const pc = peerConnections[peerId];
            createOffer(pc, peerId);
        }
        callButton.style.display = 'none';
        hangupButton.style.display = 'inline-block';
    } catch (error) {
        console.error('Error getting user media:', error);
        alert('Could not get your camera and microphone. Please check permissions.');
    }
};

hangupButton.onclick = () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    for (const peerId in peerConnections) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }
    videoGrid.innerHTML = '';
    callButton.style.display = 'inline-block';
    hangupButton.style.display = 'none';
};

joinButton.onclick = () => {
    roomName = roomInput.value.trim();
    if (roomName && localUsername) {
        statusMessage.textContent = `Joining room '${roomName}' as '${localUsername}'...`;
        ws.send(JSON.stringify({ type: 'join_room', room: roomName, username: localUsername }));
        updateOnlineUsersList();
    } else {
        alert('Please log in first and enter a valid room name.');
    }
};

refreshRoomsButton.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_active_rooms' }));
    } else {
        activeRoomsList.innerHTML = '<p>Not connected to the server.</p>';
    }
};

connectToSignalingServer();

function connectToSignalingServer() {
    ws = new WebSocket(signalingServerUrl);
    ws.onopen = () => {
        console.log('Connected to signaling server.');
    };

    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        console.log('Received message:', data.type, 'from:', data.sender);

        if (data.type === 'registration_success') {
            authStatus.textContent = 'Registration successful! Please log in.';
        } else if (data.type === 'login_success') {
            localUsername = data.username;
            authSection.style.display = 'none';
            mainApp.style.display = 'flex';
            statusMessage.textContent = `Hello, ${localUsername}! Enter a room name and click Join.`;
        } else if (data.type === 'error') {
            authStatus.textContent = `Error: ${data.message}`;
        } else if (data.type === 'room_joined') {
            localPeerId = data.peerId;
            statusMessage.textContent = `You are in room '${roomName}' as '${localUsername}'. Waiting for others...`;
            mediaControls.style.display = 'block';
            updateOnlineUsersList();
            if (userListInterval) { clearInterval(userListInterval); }
            userListInterval = setInterval(() => {
                updateOnlineUsersList();
                ws.send(JSON.stringify({ type: 'get_active_rooms' }));
            }, 10000);
        } else if (data.type === 'peer_joined') {
            peerUsernames[data.peerId] = data.username;
            createPeerConnection(data.peerId);
            updateOnlineUsersList();
        } else if (data.type === 'offer') {
            peerUsernames[data.sender] = data.username;
            await handleOffer(data);
        } else if (data.type === 'answer') {
            peerUsernames[data.sender] = data.username;
            await handleAnswer(data);
        } else if (data.type === 'candidate') {
            await handleCandidate(data);
        } else if (data.type === 'peer_left') {
            removePeerConnection(data.peerId);
            delete peerUsernames[data.peerId];
            updateOnlineUsersList();
        } else if (data.type === 'chat_history') {
            chatbox.innerHTML = '';
            data.history.forEach(msg => {
                const isMyMessage = msg.sender === localUsername;
                if (msg.type === 'text') {
                    addMessageToChat(isMyMessage ? 'You' : msg.sender, msg.content, isMyMessage);
                } else if (msg.type === 'image') {
                    addImageToChat(isMyMessage ? 'You' : msg.sender, msg.content, isMyMessage);
                }
            });
        } else if (data.type === 'chat_message') {
            const isMyMessage = data.message.sender === localUsername;
            addMessageToChat(isMyMessage ? 'You' : data.message.sender, data.message.text, isMyMessage);
        } else if (data.type === 'image_message') {
            const isMyMessage = data.message.sender === localUsername;
            addImageToChat(isMyMessage ? 'You' : data.message.sender, data.message.image, isMyMessage);
        } else if (data.type === 'active_rooms_list') {
            displayActiveRooms(data.rooms);
        } else if (data.type === 'online_users_list') {
            for(let peerId in peerUsernames) {
                if(!data.users[peerId]) {
                    delete peerUsernames[peerId];
                }
            }
            for (let peerId in data.users) {
                peerUsernames[peerId] = data.users[peerId].username;
            }
            displayOnlineUsers(data.users);
        } else if (data.type === 'dm_message') {
            const senderId = data.message.senderId;
            const senderName = data.message.sender;
            if (!dmHistory[senderId]) {
                dmHistory[senderId] = [];
            }
            dmHistory[senderId].push(data.message);
            if (currentChatTarget === senderId) {
                addMessageToChat(senderName, data.message.text);
            }
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from signaling server.');
        if (userListInterval) { clearInterval(userListInterval); }
    };
    ws.onerror = (error) => { console.error('WebSocket error:', error); };
}

function addLocalVideoElement() {
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    const video = document.createElement('video');
    video.id = `video-local-${localPeerId}`;
    video.autoplay = true;
    video.playsinline = true;
    video.muted = true;
    video.srcObject = localStream;
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = localUsername;
    videoWrapper.appendChild(video);
    videoWrapper.appendChild(label);
    videoGrid.appendChild(videoWrapper);
}

function createPeerConnection(peerId) {
    if (peerConnections[peerId]) {
        console.log(`Connection to peer ${peerId} already exists.`);
        return;
    }

    const pc = new RTCPeerConnection(configuration);
    peerConnections[peerId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    pc.ontrack = (event) => {
        const remoteUsername = peerUsernames[peerId] || `Peer ${peerId}`;
        addRemoteVideoElement(peerId, event.streams[0], remoteUsername);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'candidate',
                room: roomName,
                targetPeer: peerId,
                candidate: event.candidate,
            }));
        }
    };
    
    const dataChannel = pc.createDataChannel('chat');
    dataChannels[peerId] = dataChannel;
    setupDataChannelEvents(dataChannel, peerId);

    pc.ondatachannel = (event) => {
        dataChannels[peerId] = event.channel;
        setupDataChannelEvents(dataChannels[peerId], peerId);
    };
    
    if (Object.keys(peerConnections).length === 1 && localStream) {
        createOffer(pc, peerId);
    }
}

async function createOffer(pc, peerId) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({
        type: 'offer',
        room: roomName,
        targetPeer: peerId,
        description: pc.localDescription,
        username: localUsername,
    }));
}

async function handleOffer(data) {
    createPeerConnection(data.sender);
    const pc = peerConnections[data.sender];
    await pc.setRemoteDescription(new RTCSessionDescription(data.description));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({
        type: 'answer',
        room: roomName,
        targetPeer: data.sender,
        description: pc.localDescription,
        username: localUsername,
    }));
}

async function handleAnswer(data) {
    const pc = peerConnections[data.sender];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.description));
    }
}

async function handleCandidate(data) {
    const pc = peerConnections[data.sender];
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            console.error('Error adding received ICE candidate', e);
        }
    }
}

function removePeerConnection(peerId) {
    if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }
    const videoElement = document.getElementById(`video-${peerId}`);
    if (videoElement) {
        videoElement.parentNode.remove();
    }
}

function addRemoteVideoElement(peerId, stream, username) {
    if (document.getElementById(`video-${peerId}`)) return;

    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = stream;
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = username;
    videoWrapper.appendChild(video);
    videoWrapper.appendChild(label);
    videoGrid.appendChild(videoWrapper);
}

function setupDataChannelEvents(dc, peerId) {
    dc.onopen = (event) => { console.log(`Data channel to peer ${peerId} is open.`); };
    dc.onmessage = (event) => { addMessageToChat(`Peer ${peerId}`, event.data); };
    dc.onclose = () => { console.log(`Data channel to peer ${peerId} is closed.`); };
}

chatInputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = chatInput.value;
    if (message.trim() !== '') {
        if (currentChatTarget === 'room') {
            ws.send(JSON.stringify({
                type: 'new_chat_message',
                room: roomName,
                message: message,
            }));
        } else {
            const targetPeerId = currentChatTarget;
            const dmMessage = {
                type: 'text',
                sender: localUsername,
                text: message,
            };
            if (!dmHistory[targetPeerId]) {
                dmHistory[targetPeerId] = [];
            }
            dmHistory[targetPeerId].push({ ...dmMessage, senderId: localPeerId });
            ws.send(JSON.stringify({
                type: 'new_dm_message',
                target: targetPeerId,
                message: dmMessage,
            }));
            // The server is designed to send the DM back to the sender as well, so we don't need to add it locally.
        }
        chatInput.value = '';
    }
});

uploadImageButton.onclick = () => {
    imageInput.click();
};

imageInput.onchange = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const imageData = e.target.result;
            if (currentChatTarget === 'room') {
                ws.send(JSON.stringify({
                    type: 'new_image_message',
                    room: roomName,
                    image: imageData,
                }));
            } else {
                const targetPeerId = currentChatTarget;
                const dmImage = {
                    type: 'image',
                    sender: localUsername,
                    image: imageData,
                };
                if (!dmHistory[targetPeerId]) {
                    dmHistory[targetPeerId] = [];
                }
                dmHistory[targetPeerId].push({ ...dmImage, senderId: localPeerId });
                ws.send(JSON.stringify({
                    type: 'new_dm_message',
                    target: targetPeerId,
                    message: dmImage,
                }));
            }
        };
        reader.readAsDataURL(file);
    }
    imageInput.value = '';
};

function addMessageToChat(sender, message, isMyMessage = false) {
    const messageElement = document.createElement('div');
    messageElement.textContent = `${sender}: ${message}`;
    messageElement.classList.add('message');
    if (isMyMessage) { messageElement.classList.add('my-message'); }
    chatbox.appendChild(messageElement);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function addImageToChat(sender, imageData, isMyMessage = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    if (isMyMessage) { messageElement.classList.add('my-message'); }

    const senderElement = document.createElement('span');
    senderElement.textContent = `${sender}: `;
    messageElement.appendChild(senderElement);

    const imageElement = document.createElement('img');
    imageElement.src = imageData;
    imageElement.style.maxWidth = '200px';
    imageElement.style.display = 'block';
    messageElement.appendChild(imageElement);

    chatbox.appendChild(messageElement);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function displayActiveRooms(rooms) {
    activeRoomsList.innerHTML = '';
    if (Object.keys(rooms).length === 0) {
        activeRoomsList.innerHTML = '<p>No active rooms found.</p>';
        return;
    }

    const roomListElement = document.createElement('ul');
    for (const roomName in rooms) {
        const roomData = rooms[roomName];
        const listItem = document.createElement('li');
        listItem.textContent = `Room: ${roomName} | Active Users: ${roomData.count}`;
        
        const userList = document.createElement('ul');
        roomData.users.forEach(user => {
            const userItem = document.createElement('li');
            userItem.textContent = user;
            userList.appendChild(userItem);
        });
        listItem.appendChild(userList);

        roomListElement.appendChild(listItem);
    }
    activeRoomsList.appendChild(roomListElement);
}

function updateOnlineUsersList() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_online_users', room: roomName }));
    }
}

function displayOnlineUsers(users) {
    onlineUsersList.innerHTML = '';
    const roomChatListItem = document.createElement('li');
    roomChatListItem.textContent = `Room: ${roomName}`;
    roomChatListItem.style.cursor = 'pointer';
    roomChatListItem.onclick = () => {
        currentChatTarget = 'room';
        chatTitle.textContent = `Room Chat: ${roomName}`;
        chatbox.innerHTML = '';
    };
    onlineUsersList.appendChild(roomChatListItem);

    for (const peerId in users) {
        if (peerId !== localPeerId) {
            const user = users[peerId];
            const listItem = document.createElement('li');
            listItem.textContent = user.username;
            listItem.style.cursor = 'pointer';
            listItem.onclick = () => {
                currentChatTarget = peerId;
                chatTitle.textContent = `DM with ${user.username}`;
                chatbox.innerHTML = '';
                if (dmHistory[peerId]) {
                    dmHistory[peerId].forEach(msg => {
                        const isMyMessage = msg.senderId === localPeerId;
                        if (msg.type === 'text') {
                            addMessageToChat(isMyMessage ? 'You' : msg.sender, msg.text, isMyMessage);
                        } else if (msg.type === 'image') {
                            addImageToChat(isMyMessage ? 'You' : msg.sender, msg.image, isMyMessage);
                        }
                    });
                }
            };
            onlineUsersList.appendChild(listItem);
        }
    }
}

