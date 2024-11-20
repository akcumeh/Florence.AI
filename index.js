// Imports & Integrations
import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import axios from 'axios';

const pdfParse = await import('pdf-parse');
const pdf = pdfParse.default;

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const PORT = process.env.PORT || 4000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

import setTimeout from 'timers/promises';

// Implement retry logic for webhook setup
async function setWebhookWithRetry(bot, webhookUrl, maxRetries = 5, initialDelay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await bot.telegram.setWebhook(webhookUrl);
            console.log(`Webhook successfully set to: ${webhookUrl}`);
            return true;
        } catch (error) {
            console.error(`Attempt ${attempt}/${maxRetries} failed to set webhook:`, error.message);

            if (attempt === maxRetries) {
                console.error('Max retries reached. Continuing without webhook setup...');
                return false;
            }

            // Exponential backoff: wait longer between each retry
            const delay = initialDelay * Math.pow(2, attempt - 1);
            console.log(`Retrying in ${delay / 1000} seconds...`);
            await setTimeout(delay);
        }
    }
}

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required in .env");
if (!CLAUDE_API_KEY) throw new Error("CLAUDE_API_KEY is required in .env");

const bot = new Telegraf(BOT_TOKEN);
const app = express();

import Anthropic from '@anthropic-ai/sdk';

// WhatsApp Bot

// Setup
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    default_headers: {
        "anthropic-beta": "pdfs-2024-09-25"
    }
});


// Database
var floDb_wa = new Array();

// Handy Functions
/**
 * Check if a user is new based on WaId
 * @param {string} WaId - WhatsApp ID
 * @returns {boolean}
*/
function isNewUser(WaId) {
    return floDb_wa.filter(item => item.WaId === WaId).length === 0;
}

/**
 * Add a new user to the database
 * @param {string} WaId - WhatsApp ID
 * @param {string} ProfileName 
 * @param {number} tokens 
 * @param {number} streak 
 * @param {string} referralId 
*/
function addUser_wa(WaId, ProfileName, tokens, streak, referralId = `${ProfileName[0]}${WaId}`) {
    floDb_wa.push({
        WaId,
        ProfileName,
        tokens,
        referralId,
        streak,
        lastTokenReward: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        streakDate: new Date().toISOString()
    });
}

/**
 * Get user by WhatsApp ID
 * @param {string} WaId - WhatsApp ID
 * @returns {Object|undefined}
 */
function getUser_wa(WaId) {
    return floDb_wa.find(item => item.WaId === WaId);
}

/**
 * Send a WhatsApp message
 * @param {string} newMsg 
 * @param {string} WaId 
*/
async function createMessage_wa(newMsg, WaId) {
    try {
        const message = await client.messages.create({
            body: newMsg,
            from: "whatsapp:+14155238886",
            to: `whatsapp:+${WaId}`,
        });
        return message;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

/**
 * Send welcome message to new users
 * @param {string} WaId 
 * @param {number} tokens 
 */
async function newUserWalkthru_wa(WaId, tokens) {
    await createMessage_wa(
        `Hello there! Welcome to Florence*, your educational assistant at your fingertips.\n\n` +
        `Interacting with Florence* costs you *tokens**. Every now and then you'll get these, ` +
        `but you can also purchase more of them at any time.\n\n` +
        `You currently have ${tokens} tokens*. Feel free to send your text (one token*), ` +
        `images (two tokens*), or documents (two tokens*) and get answers immediately.\n\n` +
        `Here are a few helpful commands for a smooth experience:\n\n` +
        `*/start* - Florence* is now listening to you.\n` +
        `*/about* - for more about Florence*.\n` +
        `*/tokens* - see how many tokens you have left.\n` +
        `*/streak* - see your streak.\n` +
        `*/payments* - Top up your tokens* in a click.\n\n` +
        `*Please note:* Every other message will be considered a prompt.`,
        WaId
    );
}

/**
 * Send message to Claude
 * @param {Array} messages 
 * @returns {Promise<string>}
*/
async function claudeMessage(messages) {
    try {
        const claudeMsg = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system: "You are a highly knowledgeable teacher on every subject. Your name is Florence*.",
            messages: messages,
            stream: true
        });
        
        console.log(claudeMsg);

        return claudeMsg.content[0].text;
    } catch (error) {
        console.error('Error in Claude message:', error);
        throw error;
    }
}

/**
 * Convert URL to base64
 * @param {string} url 
 * @returns {Promise<string>}
*/
async function getBase64FromUrl(url) {
    try {
        const response = await fetch(url);
        const buffer = await response.buffer();
        return buffer.toString('base64');
    } catch (error) {
        console.error('Error fetching image:', error);
        throw error;
    }
}

/**
 * Determine media type from URL or content type
 * @param {string} url 
 * @param {string|undefined} contentType 
 * @returns {string}
 */
function determineMediaType(url, contentType) {
    // If content type is provided directly, normalize it
    if (contentType) {
        // Convert to lowercase and handle common variations
        const normalizedType = contentType.toLowerCase();
        if (normalizedType.includes('jpeg') || normalizedType.includes('jpg')) {
            return 'image/jpeg';
        }
        if (normalizedType.includes('png')) {
            return 'image/png';
        }
        if (normalizedType.includes('gif')) {
            return 'image/gif';
        }
        if (normalizedType.includes('webp')) {
            return 'image/webp';
        }
    }

    // If determining from URL, ensure we return exact matches
    const extension = url.split('.').pop().toLowerCase();
    const mimeTypes = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp'
    };
    return mimeTypes[extension] || 'image/jpeg'; // default to jpeg if unable to determine
}

/**
 * Send message to Claude with attachments
 * @param {Array<{url: string, contentType: string}>} mediaItems 
 * @param {string} prompt 
 * @returns {Promise<string>}
*/
async function claudeMessageWithAttachment(mediaItems, prompt) {
    try {
        const attachmentPromises = mediaItems.map(async ({ url, contentType }) => {
            const imageData = await getBase64FromUrl(url);
            const mediaType = determineMediaType(url, contentType);
            
            // Validate media type before sending to Claude
            if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
                throw new Error(`Unsupported media type: ${mediaType}. Only JPEG, PNG, GIF, and WebP images are supported.`);
            }

            return {
                type: "image",
                source: {
                    type: "base64",
                    media_type: mediaType,
                    data: imageData
                }
            };
        });
        
        const attachments = await Promise.all(attachmentPromises);

        const claudeMsg = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            messages: [{
                role: "user",
                content: [
                    ...attachments,
                    {
                        type: "text",
                        text: prompt
                    }
                ]
            }]
        });

        return claudeMsg.content[0].text;
    } catch (error) {
        console.error('Error in claudeMessageWithAttachment:', error);
        throw error;
    }
}

/**
 * Check and update user's token rewards
 * @param {Object} user - User object
 * @returns {number} - Number of tokens awarded
*/
function checkAndUpdateTokenRewards(user) {
    const now = new Date();
    const lastReward = new Date(user.lastTokenReward);
    const hoursSinceLastReward = (now - lastReward) / (1000 * 60 * 60);
    
    let tokensAwarded = 0;

    // Award tokens every 8 hours
    if ((hoursSinceLastReward >= 8) && (user.tokens <= 4)) {
        const rewardCount = Math.floor(hoursSinceLastReward / 8);
        tokensAwarded = rewardCount * 10;
        user.tokens += tokensAwarded;
        user.lastTokenReward = now.toISOString();
    }

    return tokensAwarded;
}

/**
 * Check and update user's streak
 * @param {Object} user - User object
 * @returns {Object} - Streak information
 */
function checkAndUpdateStreak(user) {
    const now = new Date();
    const lastActivity = new Date(user.lastActivity);
    const streakDate = new Date(user.streakDate);

    // Reset streak if more than 48 hours have passed since last activity
    if ((now - lastActivity) > (48 * 60 * 60 * 1000)) {
        user.streak = 0;
        user.streakDate = now.toISOString();
        return { streakBroken: true, streakReward: 0 };
    }
    
    // Check if it's a new day (different date from streak date)
    if (now.toDateString() !== streakDate.toDateString()) {
        user.streak += 1;
        user.streakDate = now.toISOString();

        // Award tokens for streak milestones (multiples of 10)
        if (user.streak % 10 === 0) {
            user.tokens += 10;
            return { streakBroken: false, streakReward: 10 };
        }
    }
    
    return { streakBroken: false, streakReward: 0 };
}

/**
 * Update user's activity timestamps
 * @param {Object} user - User object
*/
function updateUserActivity(user) {
    user.lastActivity = new Date().toISOString();
};

app.use(bodyParser.urlencoded({ extended: false }));

app.post('/whatsapp', async (req, res) => {
    let { WaId, MessageType, ProfileName, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;

    console.log(req.body);

    try {
        if (isNewUser(WaId)) {
            addUser_wa(WaId, ProfileName, 100, 0);
            await createMessage_wa(`A new user, ${ProfileName} (+${WaId}) has joined Florence*.`, '2348164975875');
            await createMessage_wa(`A new user, ${ProfileName} (+${WaId}) has joined Florence*.`, '2348143770724');
            console.dir(floDb_wa);

            await newUserWalkthru_wa(WaId, getUser_wa(WaId).tokens);
        } else {
            const user = getUser_wa(WaId);
            if (!user) {
                throw new Error(`User ${WaId} not found in database`);
            }

            const tokenReward = checkAndUpdateTokenRewards(user);
            if (tokenReward > 0) {
                await createMessage_wa(
                    `You've earned ${tokenReward} tokens for staying active! 🎉`,
                    WaId
                );
            }

            switch (Body) {
                case '/start':
                    await createMessage_wa(
                        `Hello ${ProfileName}, welcome to Florence*! What do you need help with today?\n\n` +
                        `You have ${user.tokens} tokens.`,
                        WaId
                    );
                    break;

                case '/about':
                    console.log('Informing the user.');
                    await createMessage_wa(
                        `Florence* is the educational assistant at your fingertips. More info here: <link>.`,
                        WaId
                    );
                    break;

                case '/payments':
                    console.log('payment!');
                    await createMessage_wa(
                        `Tokens cost 1000 naira for 10. Make your payments here:\n\n` +
                        `https://flutterwave.com/pay/jinkrgxqambh`,
                        WaId
                    );
                    break;

                case '/tokens':
                    await createMessage_wa(
                        `Hey ${ProfileName.split(' ')[0]}, you have ${user.tokens} tokens.`,
                        WaId
                    );

                    if (user.tokens <= 4) {
                        await createMessage_wa(
                            `You are running low on tokens. Top up by sending /payments.`,
                            WaId
                        );
                    }
                    break;

                case '/streak':
                    await createMessage_wa(
                        `Hey ${ProfileName.split(' ')[0]}, you are on a ${user.streak}-day streak. Send one prompt a day to keep it going!`,
                        WaId
                    );
                    break;

                default:
                    console.log('Processing user message with Claude API');
                    if (user.tokens <= 0) {
                        await createMessage_wa(
                            `You've run out of tokens. Please purchase more using /payments`,
                            WaId
                        );
                        break;
                    }

                    // Update user activity and check streak before processing message
                    updateUserActivity(user);
                    const { streakBroken, streakReward } = checkAndUpdateStreak(user);

                    if (streakReward > 0) {
                        await createMessage_wa(
                            `🔥 Congratulations! You've maintained a ${user.streak}-day streak! ` +
                            `You've earned ${streakReward} bonus tokens! 🎉`,
                            WaId
                        );
                    }

                    if (MessageType === 'image' || MessageType === 'document') {
                        if (parseInt(NumMedia) > 5) {
                            await createMessage_wa(
                                `Sorry, we can't handle that many images/documents right now. ` +
                                `Please send 5 or fewer at a time.`,
                                WaId
                            );
                        } else {
                            user.tokens -= 2;
                            const mediaItems = [
                                {
                                    url: MediaUrl0,
                                    contentType: MediaContentType0
                                }
                            ].filter(item => item.url); // Only include items with valid URLs

                            const claudeResponse = await claudeMessageWithAttachment(mediaItems, Body || "Please analyze this attachment.");
                            await createMessage_wa(claudeResponse, WaId);
                        }
                    } else if (MessageType === 'text') {
                        user.tokens -= 1;
                        const claudeResponse = await claudeMessage([{ role: "user", content: Body }]);
                        await createMessage_wa(claudeResponse, WaId);
                    } else {
                        await createMessage_wa(
                            `Sorry, this is a little too much for us to handle now. ` +
                            `Could you try simplifying your prompt?`,
                            WaId
                        );
                    }
            }
        }

        res.status(200).send('Request processed successfully');
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).send('An error occurred while processing your request');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}. WhatsApp`);
});


// Telegram Bot

// In-memory database (you might want to switch to a real database later)
const floDb_tg = new Map();
const paymentRequests = new Map(); // Store timestamps of payment requests

// Claude API client
const claudeClient = axios.create({
    baseURL: 'https://api.anthropic.com/v1',
    headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
    }
});

// User management functions
async function newUserWalkthru_tg(tgId, tokens) {
    await createMessage_tg(
        `Hello there! Welcome to Florence*, your educational assistant at your fingertips.\n\n` +
        `Interacting with Florence* costs you tokens*. Every now and then you'll get these, ` +
        `but you can also purchase more of them at any time.\n\n` +
        `You currently have ${tokens} tokens*. Feel free to send your text (one token*), ` +
        `images (two tokens*), or documents (two tokens*) and get answers immediately.\n\n` +
        `Here are a few helpful commands for a smooth experience:\n\n` +
        `/start - Florence* is now listening to you.\n` +
        `/about - for more about Florence*.\n` +
        `/tokens - see how many tokens you have left.\n` +
        `/streak - see your streak.\n` +
        `/payments - Top up your tokens* in a click.\n\n` +
        `Please note: Every message except commands will be considered a prompt.`,
        tgId
    );
}
function addUser_tg(user) {
    const userData = {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name || '',
        username: user.username || '',
        language_code: user.language_code || '',
        streak: 0,
        tokens: 10,
        lastActive: new Date()
    };
    floDb_tg.set(user.id, userData);
    console.log(`User added: ${user.id}`);
    return userData;
}

function getUser_tg(tgId) {
    return floDb_tg.get(tgId);
}

// Message handling functions
async function createMessage_tg(newMsg, tgId) {
    try {
        await bot.telegram.sendMessage(tgId, newMsg);
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

async function askClaude(message) {
    try {
        const response = await claudeClient.post('/messages', {
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1024,
            messages: [{
                role: 'user',
                content: message
            }],
            system: "You are a highly knowledgeable teacher on every subject. Your name is Florence*."
        });

        // The response structure has changed
        return response.data.content[0].text;
    } catch (error) {
        console.error('Error calling Claude API:', error.response?.data || error.message);
        throw error;
    }
};

async function verifyPaymentProof(pdfBuffer, requestTimestamp) {
    if (!pdfBuffer || !(pdfBuffer instanceof Buffer)) {
        return {
            valid: false,
            reason: 'Invalid PDF data provided'
        };
    }

    try {
        // Parse the PDF buffer directly instead of reading from file
        const data = await pdf(pdfBuffer);
        const text = data.text.toLowerCase();

        // Enhanced payment verification logic
        const requiredKeywords = {
            payment: ['payment', 'paid', 'transaction'],
            platform: ['flutterwave', 'flutter', 'wave'],
            amount: ['1000', '1,000', 'ngn1000', 'ngn1,000'],
            identifier: ['florence', 'flo']
        };

        // Check for required keywords in each category
        const keywordResults = Object.entries(requiredKeywords).map(([category, keywords]) => {
            const found = keywords.some(keyword => text.includes(keyword));
            return { category, found };
        });

        const missingCategories = keywordResults
            .filter(result => !result.found)
            .map(result => result.category);

        if (missingCategories.length > 0) {
            return {
                valid: false,
                reason: `Missing required information: ${missingCategories.join(', ')}`
            };
        }

        // Extract and validate date
        // Look for common date formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
        const dateRegex = /(\d{2}[-/]\d{2}[-/]\d{4}|\d{4}[-/]\d{2}[-/]\d{2})/g;
        const dates = text.match(dateRegex);

        if (!dates || dates.length === 0) {
            return {
                valid: false,
                reason: 'No valid date found in payment proof'
            };
        }

        // Parse found dates and find the most recent one
        const validDates = dates
            .map(dateStr => {
                try {
                    // Handle both DD/MM/YYYY and YYYY-MM-DD formats
                    const parts = dateStr.split(/[-/]/);
                    if (parts[0].length === 4) {
                        // YYYY-MM-DD format
                        return new Date(parts[0], parts[1] - 1, parts[2]);
                    } else {
                        // DD/MM/YYYY format
                        return new Date(parts[2], parts[1] - 1, parts[0]);
                    }
                } catch (e) {
                    return null;
                }
            })
            .filter(date => date && !isNaN(date));

        if (validDates.length === 0) {
            return {
                valid: false,
                reason: 'Could not parse any valid dates from payment proof'
            };
        }

        const mostRecentDate = new Date(Math.max(...validDates));

        // Check if payment date is within a reasonable timeframe
        const requestDate = new Date(requestTimestamp);
        const timeDifference = Math.abs(mostRecentDate - requestDate);
        const maxTimeWindow = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

        if (timeDifference > maxTimeWindow) {
            return {
                valid: false,
                reason: 'Payment date is outside acceptable timeframe'
            };
        }

        return {
            valid: true,
            date: mostRecentDate,
            details: {
                amount: '1000 NGN',
                platform: 'Flutterwave'
            }
        };

    } catch (error) {
        console.error('Error verifying PDF:', error);
        return {
            valid: false,
            reason: 'Error processing PDF: ' + error.message
        };
    }
};

// Middleware
app.use(bot.webhookCallback('/telegram'));

bot.use((ctx, next) => {
    console.log('Incoming message:', ctx.message);
    if (!ctx.from.is_bot) {
        let user = getUser_tg(ctx.from.id);
        if (!user) {
            user = addUser_tg(ctx.from);
            newUserWalkthru_tg(user.id, user.tokens);
        }
        // Update last active timestamp
        user.lastActive = new Date();
        floDb_tg.set(user.id, user);
    }
    return next();
});

// Bot commands
bot.command('about', (ctx) => {
    ctx.reply(`Florence* is the educational assistant at your fingertips. More info here: <link>.`);
});

bot.command('tokens', (ctx) => {
    const user = getUser_tg(ctx.from.id);
    ctx.reply(`You have ${user.tokens} tokens. To top up, send /payments.`);
});

bot.command('streak', (ctx) => {
    const user = getUser_tg(ctx.from.id);
    ctx.reply(`Your current streak is ${user.streak}.\n\nSend a message every day to keep it going!`);
});

bot.command('start', (ctx) => {
    const user = getUser_tg(ctx.from.id);
    ctx.reply(`Hello ${ctx.from.first_name}, welcome to Florence*! What do you need help with today?\n\nYou have ${user.tokens} tokens.`);
});

bot.command('payments', (ctx) => {
    const user = getUser_tg(ctx.from.id);
    paymentRequests.set(user.id, new Date());
    ctx.reply(
        'Tokens cost 1000 naira for 10. Make your payments here:\n\n' +
        'https://flutterwave.com/pay/jinkrgxqambh\n\n' +
        'then send the proof of payment (PDFs only) to get your tokens.'
    );
});

// Handle PDF uploads for payment verification
bot.on('document', async (ctx) => {
    const user = getUser_tg(ctx.from.id);
    const document = ctx.message.document;

    if (!document.mime_type || document.mime_type !== 'application/pdf') {
        return ctx.reply('Please send a PDF file for payment verification.');
    }

    const requestTimestamp = paymentRequests.get(user.id);
    if (!requestTimestamp) {
        return ctx.reply('Please use /payments command first before sending proof of payment.');
    }

    try {
        ctx.reply('Verifying payment proof...');
        const file = await ctx.telegram.getFile(document.file_id);
        const response = await axios.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`, {
            responseType: 'arraybuffer'
        });

        const verificationResult = await verifyPaymentProof(response.data, requestTimestamp);

        if (verificationResult.valid) {
            user.tokens += 10;
            floDb_tg.set(user.id, user);
            paymentRequests.delete(user.id);
            ctx.reply('Payment verified! 10 tokens have been added to your account.');
        } else {
            ctx.reply(`Payment verification failed: ${verificationResult.reason}`);
        }
    } catch (error) {
        console.error('Error processing payment proof:', error);
        ctx.reply('Error processing payment proof. Please try again or contact support.');
    }
});

// Handle regular messages
bot.on('message', async (ctx) => {
    if (ctx.message.document) return; // Skip if it's a document (handled above)

    const user = getUser_tg(ctx.from.id);
    const photos = ctx.message.photo || [];

    // Validate number of attachments first
    if (photos.length > 5) {
        return ctx.reply('Please send a maximum of 5 attachments at a time.');
    }

    // Check token balance
    const requiredTokens = photos.length > 0 ? 2 * photos.length : 1;
    if (user.tokens < requiredTokens) {
        return ctx.reply('You do not have enough tokens for this request. Top up with /payments.');
    }

    try {
        // Only deduct tokens right before processing
        user.tokens -= requiredTokens;
        floDb_tg.set(user.id, user);

        await ctx.reply('Processing your request...');

        // Prepare message for Claude
        let messageForClaude = ctx.message.text || '';
        if (photos.length > 0) {
            // Add photo processing logic here when implemented
            messageForClaude = `${messageForClaude}\n[Image analysis will be implemented soon]`;
        }

        // Get response from Claude
        const response = await askClaude(messageForClaude);
        ctx.reply(response);

    } catch (error) {
        console.error('Error processing message:', error);

        // Handle specific error cases
        if (error.message === 'IMAGE_PROCESSING_DISABLED') {
            ctx.reply('Image processing is currently not available. Please send text messages only.');
        } else {
            ctx.reply('Sorry, there was an error processing your request. Please try again.');
        }

        // Refund tokens on error
        user.tokens += requiredTokens;
        floDb_tg.set(user.id, user);
    }
});

// Start Express server
app.listen(3000|PORT, async () => {
    console.log(`Server is running on port ${PORT}. Telegram`);
    const webhookUrl = `${WEBHOOK_URL}/telegram`;

    // Try to set up webhook with retry logic
    const webhookSuccess = await setWebhookWithRetry(bot, webhookUrl);

    if (!webhookSuccess) {
        // Fall back to long polling if webhook setup fails
        console.log('Falling back to long polling...');
        bot.launch().catch(error => {
            console.error('Error launching bot:', error);
        });
    }
});

// Add graceful shutdown handling
process.once('SIGINT', () => {
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
});