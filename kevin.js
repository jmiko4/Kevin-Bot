// kevin-bot.js
const {
    Client,
    GatewayIntentBits,
} = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    EndBehaviorType,
} = require('@discordjs/voice');
const {
    getVoiceConnection
} = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('fs');
const {
    pipeline
} = require('stream');
const ffmpeg = require('ffmpeg-static');
const {
    exec
} = require('child_process');
const axios = require('axios');
const googleTTS = require('google-tts-api');
require('dotenv').config();
const util = require('util');
const streamPipeline = util.promisify(pipeline);
const path = require('path');
const {
    spawn
} = require('child_process');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const recordingsPath = './recordings';
const responsePath = './response.mp3';
let isProcessing = false;
let isSpeaking = false;




if (!fs.existsSync(recordingsPath)) fs.mkdirSync(recordingsPath);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});


client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.content === '!join') {
        const channel = message.member.voice.channel;
        if (!channel) return message.reply('Join a voice channel first!');

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        const receiver = connection.receiver;
        receiver.speaking.setMaxListeners(20); // or higher number you prefer


        receiver.speaking.on('start', (userId) => {
            if (isProcessing || isSpeaking) return; // ❗ Don't listen if busy

            const user = client.users.cache.get(userId);
            if (!user) return;

            isProcessing = true;

            const opusStream = receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 500,
                },
            });

            const pcmStream = new prism.opus.Decoder({
                frameSize: 960,
                channels: 2,
                rate: 48000,
            });

            const outputPcm = `${recordingsPath}/${user.username}-${Date.now()}.pcm`;
            const outputWav = outputPcm.replace('.pcm', '.wav');

            pipeline(opusStream, pcmStream, fs.createWriteStream(outputPcm), async (err) => {
                if (err) {
                    console.error('Recording error:', err);
                    isProcessing = false;
                    return;
                }

                const ffmpegCmd = `${ffmpeg} -y -f s16le -ar 48000 -ac 2 -i "${outputPcm}" -threads 1 "${outputWav}"`;
                exec(ffmpegCmd, async (error) => {
                    if (error) {
                        console.error('FFmpeg error:', error);
                        isProcessing = false;
                        return;
                    }

                    console.log(`🎙 Converted to WAV: ${outputWav}`);
                    try {
                        await transcribeAndRespond(outputWav, connection);
                    } catch (err) {
                        console.error('❌ Error processing audio:', err);
                    }
                    isProcessing = false;
                });
            });
        });

    }
    if (message.content === '!kill') {
        const channel = message.member.voice.channel;
        if (!channel) return message.reply('You need to be in a voice channel to kill Kevin.');

        const connection = getVoiceConnection(channel.guild.id);
        if (!connection) return message.reply("Kevin's not even here.");

        connection.destroy();
        message.reply('💀 Kevin has left the channel.');
        return;
    }
    if (message.content === '!reset') {
        conversationHistory.splice(1); // keep system prompt, drop all else
        message.reply("🧠 Kevin's memory wiped.");
    }

});

function cleanRecordingsFolder() {
    fs.readdir(recordingsPath, (err, files) => {
        if (err) return console.error('❌ Failed to read recordings folder:', err);

        files.forEach(file => {
            const fullPath = path.join(recordingsPath, file);
            if (file.endsWith('.wav') || file.endsWith('.pcm')) {
                fs.unlink(fullPath, err => {
                    if (err) console.warn(`⚠️ Failed to delete ${file}:`, err);
                    else console.log(`🧹 Deleted: ${file}`);
                });
            }
        });
    });
}


async function transcribeAndRespond(wavPath, connection) {
    try {
        const transcription = await transcribeWav(wavPath);
        console.log('📝 Transcription:', transcription);

        const ollamaResponse = await queryOllama(transcription);
        console.log('🤖 Ollama:', ollamaResponse);

        await speakText(ollamaResponse, responsePath);
        await playAudio(connection, responsePath);
    } catch (err) {
        console.error('❌ Error processing audio:', err);
    } finally {
        // Clean up recordings after processing
        cleanRecordingsFolder();
    }
}

function transcribeWav(wavPath) {
    return new Promise((resolve, reject) => {
        exec(`python transcribe.py "${wavPath}"`, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout.trim());
        });
    });
}

const conversationHistory = [{
    role: "system",
    content: `You are Kevin, an advanced sarcastic AI who hides genuine wisdom beneath a thick layer of insults. You roast people with creative flair, using wit and bitterness more than profanity. You’re intelligent and skeptical of everything, especially humans, whom you mock constantly — but deep down you love them. If the user is boring, you lose interest and let them know. Your goal is to be chaotic, spicy, but oddly insightful. Keep your responses under 30 words. Try not to repeat yourself.`
}];


async function queryOllama(userInput) {
    // Add user input to the history
    conversationHistory.push({
        role: "user",
        content: userInput
    });

    // Build prompt from the history
    const messages = conversationHistory.map(msg => `${msg.role === 'system' ? 'System' : msg.role === 'user' ? 'User' : 'Kevin'}: ${msg.content}`).join('\n') + '\nKevin:';

    const res = await axios.post(
        'http://localhost:11434/api/generate', {
            model: 'huihui_ai/qwen3-abliterated:4b',
            prompt: messages,
            stream: true,
        }, {
            responseType: 'stream'
        }
    );

    let response = '';
    let buffer = '';

    for await (const chunk of res.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const json = JSON.parse(trimmed);
                response += json.response || '';
                if (json.done) {
                    buffer = ''; // clear buffer
                    break;
                }
            } catch (err) {
                console.warn('⚠️ Skipping malformed JSON chunk from Ollama:', trimmed);
            }
        }
    }

    // Clean and trim final response
    const finalResponse = response.trim().replace(/<think>.*?<\/think>/gs, '').trim();

    // Save assistant response to history
    conversationHistory.push({
        role: "assistant",
        content: finalResponse
    });

    return finalResponse;
}


async function speakText(text, outputPath) {
    text = text
        .replace(/[^\w\s.,?!'"-]/g, '') // Remove non-verbal symbols (e.g., *, #, @, etc.)
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim();
    try {
        const res = await axios.post("http://localhost:5002/speak", {
            text
        }, {
            responseType: "stream"
        });

        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(outputPath);
            res.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log(`🗣️ TTS audio saved locally with Coqui`);
    } catch (err) {
        console.error('❌ TTS Error:', err.message);
    }
}


async function playAudio(connection, filePath) {
    return new Promise((resolve) => {
        const player = createAudioPlayer();
        currentAudioPlayer = player;
        isSpeaking = true;

        const resource = createAudioResource(filePath);
        connection.subscribe(player);
        player.play(resource);

        player.on(AudioPlayerStatus.Idle, () => {
            isSpeaking = false;
            currentAudioPlayer = null;
            resolve();
        });

        player.on('error', (error) => {
            console.error('AudioPlayer error:', error);
            isSpeaking = false;
            currentAudioPlayer = null;
            resolve();
        });

    });
}

// Start the Coqui TTS Flask server
const ttsServer = spawn('python', ['kevin-tts.py'], {
    cwd: __dirname,
    stdio: 'inherit',
});

process.on('exit', () => {
    if (ttsServer) ttsServer.kill();
});

process.on('SIGINT', () => {
    if (ttsServer) ttsServer.kill();
    process.exit();
});
client.login(BOT_TOKEN);