import * as L from 'leaflet';

// --- DOM Elements ---
const mapElement = document.getElementById('map');
const statusDiv = document.getElementById('status');
const startBtn = document.getElementById('start-btn');
const playBtn = document.getElementById('play-btn');
const resetBtn = document.getElementById('reset-btn');
const playbackAudio = document.getElementById('playback-audio');

// --- State Variables ---
let map;
let trailPolyline;
let characterMarker;
let mediaRecorder;
let audioChunks = [];
let audioBlob;
let trailData = [];
let watchId;
let isRecording = false;
let isPlaying = false;
let animationFrameId;

// --- Custom Icons ---
const characterIcon = L.icon({
    iconUrl: 'character.png',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
});
const startIcon = L.icon({
    iconUrl: 'start-marker.png',
    iconSize: [41, 41],
    iconAnchor: [20, 41],
});
const endIcon = L.icon({
    iconUrl: 'end-marker.png',
    iconSize: [41, 41],
    iconAnchor: [20, 41],
});

// --- Initialization ---
function init() {
    // Initialize map centered on a default location
    map = L.map(mapElement).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Try to get user's current location to center the map
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            map.setView([latitude, longitude], 16);
        },
        () => {
            statusDiv.textContent = "Could not get location. Using default.";
        },
        { enableHighAccuracy: true }
    );
    
    setupEventListeners();
}

function setupEventListeners() {
    startBtn.addEventListener('click', toggleRecording);
    playBtn.addEventListener('click', togglePlayback);
    resetBtn.addEventListener('click', resetApp);
}

// --- Recording Logic ---
async function toggleRecording() {
    if (isRecording) {
        stopWalk();
    } else {
        await startWalk();
    }
}

async function startWalk() {
    try {
        // Get media permissions
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Reset state for a new walk
        resetApp();
        
        // Setup MediaRecorder
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
        mediaRecorder.onstop = () => {
            audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            playbackAudio.src = URL.createObjectURL(audioBlob);
        };
        
        // Start recording
        mediaRecorder.start();
        isRecording = true;
        
        // Start GPS tracking
        watchId = navigator.geolocation.watchPosition(
            handlePositionUpdate,
            handlePositionError,
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );

        // Update UI
        updateUIForRecording();
        
    } catch (err) {
        statusDiv.textContent = 'Error: Microphone or GPS access denied.';
        console.error('Error starting walk:', err);
    }
}

function stopWalk() {
    if (!isRecording) return;
    
    // Stop recording and GPS
    mediaRecorder.stop();
    navigator.geolocation.clearWatch(watchId);
    isRecording = false;
    
    // Add end marker
    if (trailData.length > 0) {
        const lastPoint = trailData[trailData.length - 1];
        L.marker([lastPoint.lat, lastPoint.lng], { icon: endIcon }).addTo(map);
    }

    updateUIForPlayback();
}

// --- GPS Handling ---
function handlePositionUpdate(position) {
    const { latitude, longitude } = position.coords;
    const timestamp = position.timestamp;
    const point = { lat: latitude, lng: longitude, time: timestamp };
    
    if (trailData.length === 0) {
        // This is the first point
        trailData.push(point);
        trailPolyline = L.polyline([point], { color: 'blue' }).addTo(map);
        L.marker([point.lat, point.lng], { icon: startIcon }).addTo(map);
    } else {
        const lastPoint = trailData[trailData.length - 1];
        // Only add point if it's different from the last one
        if (lastPoint.lat !== point.lat || lastPoint.lng !== point.lng) {
            trailData.push(point);
            trailPolyline.addLatLng(point);
        }
    }
    
    map.setView([latitude, longitude], 18);
    statusDiv.textContent = `Recording... Points: ${trailData.length}`;
}

function handlePositionError(error) {
    statusDiv.textContent = `GPS Error: ${error.message}`;
}

// --- Playback Logic ---
function togglePlayback() {
    if (isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    if (trailData.length < 2 || !audioBlob) {
        statusDiv.textContent = "Not enough data to play.";
        return;
    }

    isPlaying = true;
    playBtn.textContent = 'Stop Playback';
    playBtn.classList.add('playing');
    statusDiv.textContent = "Playing...";
    
    // Create character marker
    const startPoint = trailData[0];
    characterMarker = L.marker([startPoint.lat, startPoint.lng], { icon: characterIcon, zIndexOffset: 1000 }).addTo(map);

    // Play audio
    playbackAudio.currentTime = 0;
    playbackAudio.play();

    // Start animation loop
    animationFrameId = requestAnimationFrame(animateCharacter);
}

function stopPlayback() {
    isPlaying = false;
    playBtn.textContent = 'Play Trail';
    playBtn.classList.remove('playing');
    statusDiv.textContent = "Playback stopped.";

    playbackAudio.pause();
    cancelAnimationFrame(animationFrameId);

    if (characterMarker) {
        map.removeLayer(characterMarker);
        characterMarker = null;
    }
}

function animateCharacter() {
    if (!isPlaying) return;

    const elapsedTime = playbackAudio.currentTime * 1000;
    const walkStartTime = trailData[0].time;
    const targetTime = walkStartTime + elapsedTime;
    
    // Find where the character should be on the trail
    let currentPos = trailData[0];
    for (let i = 1; i < trailData.length; i++) {
        const p1 = trailData[i-1];
        const p2 = trailData[i];

        if (targetTime >= p1.time && targetTime <= p2.time) {
            const timeDiff = p2.time - p1.time;
            if (timeDiff > 0) {
                const progress = (targetTime - p1.time) / timeDiff;
                const lat = p1.lat + (p2.lat - p1.lat) * progress;
                const lng = p1.lng + (p2.lng - p1.lng) * progress;
                currentPos = { lat, lng };
            } else {
                 currentPos = p1;
            }
            break;
        }
        if (i === trailData.length - 1 && targetTime > p2.time) {
           currentPos = p2;
        }
    }
    
    characterMarker.setLatLng([currentPos.lat, currentPos.lng]);
    map.panTo([currentPos.lat, currentPos.lng]);

    // Check if playback is finished
    if (playbackAudio.ended) {
        stopPlayback();
        statusDiv.textContent = "Trail finished!";
    } else {
        animationFrameId = requestAnimationFrame(animateCharacter);
    }
}


// --- UI and State Management ---
function updateUIForRecording() {
    startBtn.textContent = 'Stop Walk';
    startBtn.classList.add('recording');
    playBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');
    statusDiv.textContent = "Walk started! Recording...";
}

function updateUIForPlayback() {
    startBtn.classList.add('hidden');
    startBtn.classList.remove('recording');
    startBtn.textContent = 'Start Walk';
    
    if (trailData.length > 1 && audioBlob) {
        playBtn.classList.remove('hidden');
        statusDiv.textContent = "Walk finished! Ready to play.";
    } else {
        statusDiv.textContent = "Walk finished, but no trail was recorded.";
    }
    resetBtn.classList.remove('hidden');
}

function resetApp() {
    stopPlayback();
    
    // Clear map layers
    map.eachLayer(layer => {
        if (layer instanceof L.Polyline || layer instanceof L.Marker) {
            map.removeLayer(layer);
        }
    });

    // Reset state
    trailData = [];
    audioBlob = null;
    playbackAudio.src = '';
    
    // Reset UI
    startBtn.classList.remove('hidden');
    startBtn.classList.remove('recording');
    startBtn.textContent = 'Start Walk';
    playBtn.classList.add('hidden');
    playBtn.classList.remove('playing');
    playBtn.textContent = 'Play Trail';
    resetBtn.classList.add('hidden');
    statusDiv.textContent = "Welcome! Press 'Start Walk' to begin.";
}

// --- Entry Point ---
init();