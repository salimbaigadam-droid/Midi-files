// Simple MIDI Parser
class MidiParser {
    constructor(arrayBuffer) {
        this.data = new Uint8Array(arrayBuffer);
        this.pos = 0;
    }

    readBytes(n) {
        const result = this.data.slice(this.pos, this.pos + n);
        this.pos += n;
        return result;
    }

    readVarLength() {
        let result = 0;
        let byte;
        do {
            byte = this.data[this.pos++];
            result = (result << 7) | (byte & 0x7f);
        } while (byte & 0x80);
        return result;
    }

    parse() {
        const header = this.readBytes(4).toString();
        const headerLength = this.readInt32();
        const format = this.readInt16();
        const trackCount = this.readInt16();
        const division = this.readInt16();

        const tracks = [];
        for (let i = 0; i < trackCount; i++) {
            tracks.push(this.parseTrack(division));
        }

        return {
            format,
            trackCount,
            division,
            tracks,
            maxTime: Math.max(...tracks.map(t => Math.max(...t.events.map(e => e.time), 0)))
        };
    }

    parseTrack(division) {
        const trackHeader = this.readBytes(4).toString();
        const trackLength = this.readInt32();
        const trackEnd = this.pos + trackLength;
        const events = [];

        let currentTime = 0;
        let runningStatus = 0;

        while (this.pos < trackEnd) {
            const deltaTime = this.readVarLength();
            currentTime += deltaTime;

            let byte = this.data[this.pos];

            if (byte === 0xff) { // Meta event
                this.pos++;
                const metaType = this.data[this.pos++];
                const length = this.readVarLength();
                this.readBytes(length); // Skip meta event data
            } else if (byte === 0xf0 || byte === 0xf7) { // SysEx event
                this.pos++;
                const length = this.readVarLength();
                this.readBytes(length);
            } else if (byte & 0x80) {
                runningStatus = byte;
                this.pos++;
                const data1 = this.data[this.pos++];
                const data2 = this.data[this.pos++];

                const status = runningStatus & 0xf0;
                const channel = runningStatus & 0x0f;

                if (status === 0x90 && data2 > 0) { // Note on
                    events.push({
                        time: currentTime,
                        type: 'noteOn',
                        note: data1,
                        velocity: data2
                    });
                } else if (status === 0x80 || (status === 0x90 && data2 === 0)) { // Note off
                    events.push({
                        time: currentTime,
                        type: 'noteOff',
                        note: data1
                    });
                }
            } else {
                const data1 = this.data[this.pos++];
                const data2 = this.data[this.pos++];
            }
        }

        return { events };
    }

    readInt16() {
        const value = (this.data[this.pos] << 8) | this.data[this.pos + 1];
        this.pos += 2;
        return value;
    }

    readInt32() {
        const value = (this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) |
            (this.data[this.pos + 2] << 8) | this.data[this.pos + 3];
        this.pos += 4;
        return value;
    }
}

// MIDI to Roblox Piano Key Mapping
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROBLOX_KEYS = {
    'C': '1', 'C#': 'Q', 'D': '2', 'D#': 'W', 'E': '3', 'F': '4',
    'F#': 'R', 'G': '5', 'G#': 'T', 'A': '6', 'A#': 'Y', 'B': '7'
};

function midiNoteToKey(note, octaveOffset = 0) {
    const octave = Math.floor(note / 12) - 1 + octaveOffset;
    const noteName = NOTE_NAMES[note % 12];
    
    if (octave < 4 || octave > 8) return null;
    
    return ROBLOX_KEYS[noteName];
}

function getMidiNoteName(note) {
    const octave = Math.floor(note / 12) - 1;
    const noteName = NOTE_NAMES[note % 12];
    return noteName + octave;
}

// UI Elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const convertBtn = document.getElementById('convertBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const output = document.getElementById('output');
const status = document.getElementById('status');
const stats = document.getElementById('stats');
const noteCount = document.getElementById('noteCount');
const duration = document.getElementById('duration');
const pianoPreview = document.getElementById('pianoPreview');

let midiData = null;
let currentMidiFile = null;

// File upload handlers
uploadArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        loadMidiFile(e.target.files[0]);
    }
});

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        loadMidiFile(e.dataTransfer.files[0]);
    }
});

function loadMidiFile(file) {
    currentMidiFile = file;
    showStatus(`Loading ${file.name}...`, 'info');
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parser = new MidiParser(e.target.result);
            midiData = parser.parse();
            convertBtn.disabled = false;
            showStatus(`✓ Loaded: ${file.name}`, 'success');
        } catch (error) {
            showStatus(`Error parsing MIDI: ${error.message}`, 'error');
            midiData = null;
            convertBtn.disabled = true;
        }
    };
    reader.readAsArrayBuffer(file);
}

convertBtn.addEventListener('click', () => {
    if (!midiData) return;

    const octaveOffset = parseInt(document.getElementById('octaveOffset').value);
    const tempoMultiplier = parseFloat(document.getElementById('tempo').value);
    const tableName = document.getElementById('tableName').value;

    try {
        const notes = extractNotes(midiData, octaveOffset, tempoMultiplier);
        const luauCode = generateLuauCode(notes, tableName, midiData);
        
        output.textContent = luauCode;
        output.style.display = 'block';
        stats.style.display = 'grid';
        copyBtn.style.display = 'inline-block';
        downloadBtn.style.display = 'inline-block';
        
        noteCount.textContent = notes.length;
        const maxTime = Math.max(...notes.map(n => n.time + n.duration));
        duration.textContent = (maxTime / 1000).toFixed(2) + 's';
        
        visualizePiano(notes);
        showStatus(`✓ Converted ${notes.length} notes`, 'success');
    } catch (error) {
        showStatus(`Conversion error: ${error.message}`, 'error');
    }
});

function extractNotes(midiData, octaveOffset, tempoMultiplier) {
    const notes = [];
    const noteOnTimes = {};

    midiData.tracks.forEach(track => {
        track.events.forEach(event => {
            if (event.type === 'noteOn') {
                const key = midiNoteToKey(event.note, octaveOffset);
                if (key) {
                    noteOnTimes[event.note] = event.time;
                }
            } else if (event.type === 'noteOff') {
                const key = midiNoteToKey(event.note, octaveOffset);
                if (key && noteOnTimes[event.note] !== undefined) {
                    const startTime = noteOnTimes[event.note];
                    const duration = event.time - startTime;
                    notes.push({
                        key,
                        time: Math.round(startTime * tempoMultiplier),
                        duration: Math.round(duration * tempoMultiplier),
                        note: getMidiNoteName(event.note),
                        midi: event.note
                    });
                    delete noteOnTimes[event.note];
                }
            }
        });
    });

    return notes.sort((a, b) => a.time - b.time);
}

function generateLuauCode(notes, tableName, midiData) {
    let code = `-- Generated Roblox Piano Key Map\n`;
    code += `-- Converted from MIDI file\n`;
    code += `-- Total Notes: ${notes.length}\n`;
    code += `-- Duration: ${(Math.max(...notes.map(n => n.time + n.duration)) / 1000).toFixed(2)}s\n\n`;
    
    code += `local ${tableName} = {\n`;
    
    notes.forEach((note, index) => {
        code += `\t{\n`;
        code += `\t\tkey = "${note.key}",\n`;
        code += `\t\ttime = ${note.time},\n`;
        code += `\t\tduration = ${note.duration},\n`;
        code += `\t\tnote = "${note.note}",\n`;
        code += `\t\tmidi = ${note.midi}\n`;
        code += `\t}${index < notes.length - 1 ? ',' : ''}\n`;
    });
    
    code += `}\n\n`;
    code += `-- Usage Example:\n`;
    code += `-- for _, noteData in ipairs(${tableName}) do\n`;
    code += `--     local key = noteData.key\n`;
    code += `--     local time = noteData.time\n`;
    code += `--     -- Play the key at the specified time\n`;
    code += `-- end\n`;
    
    return code;
}

function visualizePiano(notes) {
    pianoPreview.innerHTML = '';
    
    // Create visual piano keys
    for (let note = 60; note <= 84; note++) { // C4 to C7
        const noteName = getMidiNoteName(note);
        const isBlack = noteName.includes('#');
        
        const key = document.createElement('div');
        key.className = `piano-key ${isBlack ? 'black' : 'white'}`;
        key.textContent = !isBlack ? noteName.substring(0, 1) : '';
        key.title = noteName;
        
        // Check if this note is in the song
        if (notes.some(n => n.midi === note)) {
            key.classList.add('played');
        }
        
        pianoPreview.appendChild(key);
    }
    
    pianoPreview.style.display = 'flex';
}

clearBtn.addEventListener('click', () => {
    fileInput.value = '';
    midiData = null;
    currentMidiFile = null;
    output.style.display = 'none';
    stats.style.display = 'none';
    copyBtn.style.display = 'none';
    downloadBtn.style.display = 'none';
    pianoPreview.style.display = 'none';
    convertBtn.disabled = true;
    status.style.display = 'none';
});

copyBtn.addEventListener('click', () => {
    const text = output.textContent;
    navigator.clipboard.writeText(text).then(() => {
        showStatus('✓ Copied to clipboard!', 'success');
    });
});

downloadBtn.addEventListener('click', () => {
    const text = output.textContent;
    const filename = (document.getElementById('tableName').value || 'piano') + '.lua';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('✓ Downloaded: ' + filename, 'success');
});

function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;
}