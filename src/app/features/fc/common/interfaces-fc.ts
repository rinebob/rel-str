import {
    FieldValue,
  } from '@angular/fire/firestore';

export interface ChatMessage {
    name: string,
    profilePicUrl: string,
    // timestamp: FieldValue,
    uid: string,
    text?: string,
    imageUrl?: string
  };

  export const CHAT_MESSAGE_INITIALIZER: ChatMessage = {
    name: 'CHAT MESSAGE INITIALIZER',
    profilePicUrl: '',
    uid: '',
    text: '',
    imageUrl: '',
  }