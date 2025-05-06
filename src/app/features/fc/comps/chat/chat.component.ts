import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { DocumentData } from '@angular/fire/firestore';
import { FormsModule } from '@angular/forms';
import { Observable, of } from 'rxjs';

import { ChatService } from '../../services/chat.service';
import { MOCK_MESSAGES } from '../../common/messages-mock-data';

@Component({
  selector: 'app-chat-page',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  standalone: true,
  imports: [AsyncPipe, FormsModule]
})
export class ChatComponent {
  chatService = inject(ChatService);
//   messages$ = this.chatService.loadMessages() as Observable<DocumentData[]>;
  messages$ = of(MOCK_MESSAGES);
  user$ = this.chatService.user$;
  text = '';

  ngOnInit() {
    this.messages$.pipe().subscribe(messages => {
        console.log('c ngOI messages sub: ', messages)
    });
  }

  sendTextMessage() {
    this.chatService.saveTextMessage(this.text);
    this.text = '';
  }

  uploadImage(event: any) {
    const imgFile: File = event.target.files[0];
    if (!imgFile) {
      return;
    }
    this.chatService.saveImageMessage(imgFile);
  }
}
