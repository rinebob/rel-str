import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthStore } from '../../auth/auth.store';

@Component({
    selector: 'rs-signup',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './signup.component.html',
    styleUrls: ['./signup.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignupComponent {
    private readonly fb = inject(FormBuilder);
    private readonly auth = inject(AuthStore);

    readonly form = this.fb.nonNullable.group({
        displayName: [''],
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(6)]],
    });

    readonly loading = this.auth.loading;
    readonly error = this.auth.error;

    readonly canSubmit = computed(() => this.form.valid && !this.loading());

    async onSubmit(): Promise<void> {
        if (!this.form.valid) return;
        const { email, password, displayName } = this.form.getRawValue();
        await this.auth.signUpWithEmail(email, password, displayName || undefined);
    }

    async onGoogle(): Promise<void> {
        await this.auth.signInWithGoogle();
    }
}
