

// export interface ChatMessage {
//     name: string,
//     profilePicUrl: string,
//     // timestamp: FieldValue,
//     uid: string,
//     text?: string,
//     imageUrl?: string
//   };

import { ChatMessage } from "./interfaces-fc";

export const MESSAGE_ONE: ChatMessage = {
    name: 'hey its a message!',
    profilePicUrl: '',
    uid: '',
    text: 'wow this is some message!',
    imageUrl: '',
    response: 'Dude thats awesome!!',
}

export const MESSAGE_TWO: ChatMessage = {
    name: 'hey its a message! This is number two!',
    profilePicUrl: '',
    uid: '',
    text: 'here is some information dude.  theres a lot! tempora modi molestiae sapiente nihil reiciendis quis at magni harum nostrum alias animi, repudiandae nesciunt saepe optio inventore facere blanditiis. Harum eius dignissimos magnam debitis, quis animi nam inventore!',
    imageUrl: '',
    response: 'great news in your message!',
}

export const MESSAGE_THREE: ChatMessage = {
    name: ' This is number three',
    profilePicUrl: '',
    uid: '',
    text: 'Lorem ipsum, dolor sit amet consectetur adipisicing elit. Fuga tempore laborum voluptatem soluta nobis amet ullam natus, tempora modi molestiae sapiente nihil reiciendis quis at magni harum nostrum alias animi, repudiandae nesciunt saepe optio inventore facere blanditiis. Harum eius dignissimos magnam debitis, quis animi nam inventore! Nihil praesentium unde modi?',
    imageUrl: '',
    response: 'hey thats some message!',
}

export const MOCK_MESSAGES: ChatMessage[] = [
    MESSAGE_ONE,
    MESSAGE_TWO,
    MESSAGE_THREE
];