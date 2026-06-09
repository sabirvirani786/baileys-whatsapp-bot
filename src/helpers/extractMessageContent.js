/**
 * Extracts readable content from any WhatsApp message type
 * Supports: text, images, videos, documents, buttons, lists, reactions, etc.
 * @param {Object} message - The raw message object from Baileys
 * @returns {Object} Parsed content with type and text
 */
export function extractMessageContent(message) {
    if (!message) return { type: 'unknown', text: '' };

    const msg = message.message || message;

    // Text messages
    if (msg.conversation) {
        return { type: 'text', text: msg.conversation };
    }

    // Extended text (most common for replies/links)
    if (msg.extendedTextMessage?.text) {
        return { 
            type: 'extended_text', 
            text: msg.extendedTextMessage.text 
        };
    }

    // Image with caption
    if (msg.imageMessage?.caption) {
        return { 
            type: 'image', 
            text: msg.imageMessage.caption,
            hasMedia: true 
        };
    }

    // Video with caption
    if (msg.videoMessage?.caption) {
        return { 
            type: 'video', 
            text: msg.videoMessage.caption,
            hasMedia: true 
        };
    }

    // Document with caption
    if (msg.documentMessage?.caption) {
        return { 
            type: 'document', 
            text: msg.documentMessage.caption,
            hasMedia: true 
        };
    }

    // Audio
    if (msg.audioMessage) {
        return { type: 'audio', text: '[Voice Message]', hasMedia: true };
    }

    // Sticker
    if (msg.stickerMessage) {
        return { type: 'sticker', text: '[Sticker]' };
    }

    // Location
    if (msg.locationMessage) {
        return { 
            type: 'location', 
            text: `[Location: ${msg.locationMessage.degreesLatitude}, ${msg.locationMessage.degreesLongitude}]` 
        };
    }

    // Contact
    if (msg.contactMessage) {
        return { type: 'contact', text: '[Shared Contact]' };
    }

    // Button Response
    if (msg.buttonsResponseMessage?.selectedDisplayText) {
        return { 
            type: 'button_response', 
            text: msg.buttonsResponseMessage.selectedDisplayText 
        };
    }

    // List Response
    if (msg.listResponseMessage?.title) {
        return { 
            type: 'list_response', 
            text: msg.listResponseMessage.title 
        };
    }

    // Template Button Reply
    if (msg.templateButtonReplyMessage?.selectedId) {
        return { 
            type: 'template_button', 
            text: msg.templateButtonReplyMessage.selectedId 
        };
    }

    // Reaction
    if (msg.reactionMessage) {
        return { 
            type: 'reaction', 
            text: msg.reactionMessage.text || '[Reaction]' 
        };
    }

    // Poll / Others
    if (msg.pollCreationMessage || msg.pollUpdateMessage) {
        return { type: 'poll', text: '[Poll Message]' };
    }

    // Fallback
    return { 
        type: 'unknown', 
        text: '[Unsupported Message Type]' 
    };
}