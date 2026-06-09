/**
 * Extracts readable text from any WhatsApp message type.
 */
export function extractMessageContent(message: any): { type: string; text: string; hasMedia?: boolean } {
  if (!message) return { type: 'unknown', text: '' };
  const msg = message.message || message;

  if (msg.conversation)
    return { type: 'text', text: msg.conversation };

  if (msg.extendedTextMessage?.text)
    return { type: 'extended_text', text: msg.extendedTextMessage.text };

  if (msg.imageMessage?.caption)
    return { type: 'image', text: msg.imageMessage.caption, hasMedia: true };

  if (msg.videoMessage?.caption)
    return { type: 'video', text: msg.videoMessage.caption, hasMedia: true };

  if (msg.documentMessage?.caption)
    return { type: 'document', text: msg.documentMessage.caption, hasMedia: true };

  if (msg.audioMessage)
    return { type: 'audio', text: '[Voice Message]', hasMedia: true };

  if (msg.stickerMessage)
    return { type: 'sticker', text: '[Sticker]' };

  if (msg.locationMessage)
    return { type: 'location', text: `[Location: ${msg.locationMessage.degreesLatitude}, ${msg.locationMessage.degreesLongitude}]` };

  if (msg.contactMessage)
    return { type: 'contact', text: '[Shared Contact]' };

  if (msg.buttonsResponseMessage?.selectedDisplayText)
    return { type: 'button_response', text: msg.buttonsResponseMessage.selectedDisplayText };

  if (msg.listResponseMessage?.title)
    return { type: 'list_response', text: msg.listResponseMessage.title };

  if (msg.templateButtonReplyMessage?.selectedId)
    return { type: 'template_button', text: msg.templateButtonReplyMessage.selectedId };

  if (msg.reactionMessage)
    return { type: 'reaction', text: msg.reactionMessage.text || '[Reaction]' };

  if (msg.pollCreationMessage || msg.pollUpdateMessage)
    return { type: 'poll', text: '[Poll Message]' };

  return { type: 'unknown', text: '[Unsupported Message Type]' };
}
