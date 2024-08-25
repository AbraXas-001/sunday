import { Boom } from '@hapi/boom';
import { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState, makeInMemoryStore, makeCacheableSignalKeyStore } from 'baileys';
import readline from 'readline';
import NodeCache from 'node-cache';
import fs from 'fs';
import P from 'pino';

// Logger to track events
const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'));
logger.level = 'trace';

// Configuration flags based on command-line arguments
const useStore = !process.argv.includes('--no-store');
const usePairingCode = process.argv.includes('--use-pairing-code');

// Create a cache for message retries
const msgRetryCounterCache = new NodeCache();

// Map for handling on-demand data
const onDemandMap = new Map<string, string>();

// Readline interface for input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve));

// Create store for maintaining WhatsApp connection data
const store = useStore ? makeInMemoryStore({ logger }) : undefined;
store?.readFromFile('./baileys_store_multi.json');

// Save the store data every 10 seconds
setInterval(() => {
    store?.writeToFile('./baileys_store_multi.json');
}, 10_000);

// Start the WhatsApp connection
const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version } = await fetchLatestBaileysVersion();
    console.log(`using WA v${version.join('.')}`);

    // Create the WhatsApp socket
    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: true,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
    });

    store?.bind(sock.ev);

    // Handle pairing code for Web clients
    if (usePairingCode && !sock.authState.creds.registered) {
        const phoneNumber = await question('Please enter your mobile phone number:\n');
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`Pairing code: ${code}`);
    }

    // Process WhatsApp connection events
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
                startSock(); // Reconnect if not logged out
            } else {
                console.log('Connection closed. You are logged out.');
            }
        }
        console.log('connection update', update);
    });

    // Save credentials if updated
    sock.ev.on('creds.update', async () => {
        await saveCreds();
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (upsert) => {
        if (upsert.type === 'notify') {
            for (const msg of upsert.messages) {
                if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
                    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

                    // Respond to specific messages
                    if (text === 'requestPlaceholder') {
                        const messageId = await sock.requestPlaceholderResend(msg.key);
                        console.log('requested placeholder resync, id=', messageId);
                    } else if (text === 'onDemandHistSync') {
                        const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp!);
                        console.log('requested on-demand sync, id=', messageId);
                    }
                }

                // Automatically reply to incoming messages
                if (!msg.key.fromMe) {
                    console.log('replying to', msg.key.remoteJid);
                    await sock.sendMessage(msg.key.remoteJid!, { text: 'Hello there!' });
                }
            }
        }
    });

    // Handle other events
    sock.ev.on('messages.update', (update) => {
        console.log(JSON.stringify(update, undefined, 2));
    });

    sock.ev.on('message-receipt.update', (update) => {
        console.log(update);
    });

    sock.ev.on('messages.reaction', (update) => {
        console.log(update);
    });

    sock.ev.on('presence.update', (update) => {
        console.log(update);
    });

    sock.ev.on('chats.update', (update) => {
        console.log(update);
    });

    sock.ev.on('contacts.update', (update) => {
        console.log(update);
    });
};

// Start the WhatsApp connection
startSock();
