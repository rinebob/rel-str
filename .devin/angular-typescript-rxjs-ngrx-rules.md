# Angular, TypeScript, RxJS, and NgRx Coding Standards

**Applies to:** All Angular frontend code in this repository  
**Angular Version:** 19+ (with 20/21 features where applicable)  
**Last Updated:** June 2026

---

## 1. Angular Architecture Standards

### 1.1 Component Structure

**Default:** Separate files for template, styles, and logic.

```
my-component/
├── my-component.component.ts    # Component logic (UI layer only)
├── my-component.component.html  # Template
└── my-component.component.scss  # Styles
```

**Correct - Separate Files:**
```typescript
// user-profile.component.ts
@Component({
  selector: 'app-user-profile',
  imports: [CommonModule, MatButtonModule],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.scss'
})
export class UserProfileComponent {
  // logic here
}
```

**Exception - Small Components (≤10 lines):**
Inline templates and styles are acceptable for very simple components:

```typescript
// simple-button.component.ts
@Component({
  selector: 'app-simple-button',
  imports: [MatButtonModule],
  template: `<button mat-button (click)="clicked.emit()">{{ label() }}</button>`,
  styles: [`button { min-width: 80px; }`]
})
export class SimpleButtonComponent {
  label = input.required<string>();
  clicked = output<void>();
}
```

**Note:** `standalone: true` is the default in Angular 19+ - do not explicitly add it.

### 1.2 Strict Separation of Concerns (MANDATORY)

**NEVER put business logic in components.** Components are the **UI layer only**.

| **UI Layer (Components)** | **Business Logic Layer (Stores/Services)** |
|---------------------------|-------------------------------------------|
| Template bindings | State management |
| Event handlers (call store methods) | API calls |
| Conditional CSS classes | Data transformations |
| User input capture | Form validation logic |
| Navigation triggers | Business rules |
| Display formatting (pipes) | Side effects (snackbars, logging) |

**Component Responsibilities (ALLOWED):**
```typescript
@Component({
  providers: [UserStore]  // Component-scoped store
})
export class UserComponent {
  // 1. Inject store (single dependency)
  readonly store = inject(UserStore);
  
  // 2. UI helper methods (formatting, styling)
  getStatusColor(status: string): string {
    switch (status) {
      case 'active': return 'success';
      case 'inactive': return 'warn';
      default: return 'default';
    }
  }
  
  // 3. Event handlers that delegate to store
  onRefresh(): void {
    this.store.loadUsers();  // Delegate to store
  }
  
  // 4. Navigation
  onUserClick(userId: string): void {
    this.router.navigate(['/users', userId]);
  }
}
```

**Component Anti-Patterns (FORBIDDEN):**
```typescript
// ❌ BAD - Business logic in component
@Component({...})
export class BadComponent {
  users = signal<User[]>([]);  // State belongs in store
  isLoading = signal(false);   // State belongs in store
  
  constructor() {
    // ❌ BAD - API call in component
    this.http.get('/api/users').subscribe(users => {
      this.users.set(users);  // State update belongs in store
    });
  }
  
  // ❌ BAD - Business logic in component
  calculateTotal(): number {
    return this.users().reduce((sum, u) => sum + u.balance, 0);
  }
  
  // ❌ BAD - Side effects in component
  onSave(): void {
    this.http.post('/api/users', this.form.value).subscribe(() => {
      this.snackBar.open('Saved!');  // Side effect belongs in store
      this.loadData();  // State refresh belongs in store
    });
  }
}
```

**Store Responsibilities (REQUIRED for business logic):**
```typescript
// user.store.ts
export const UserStore = signalStore(
  withState({ users: [], isLoading: false }),
  
  withComputed((state) => ({
    // ✅ Business calculation in store
    totalBalance: computed(() => 
      state.users().reduce((sum, u) => sum + u.balance, 0)
    ),
  })),
  
  withMethods((state, http = inject(HttpClient), snackBar = inject(MatSnackBar)) => ({
    // ✅ API calls in store
    loadUsers(): void {
      patchState(state, { isLoading: true });
      http.get<User[]>('/api/users').subscribe({
        next: (users) => patchState(state, { users, isLoading: false }),
        error: (err) => {
          patchState(state, { isLoading: false });
          snackBar.open('Failed to load users', 'Dismiss', { duration: 5000 });
        }
      });
    },
    
    // ✅ Side effects in store
    async saveUser(user: User): Promise<void> {
      await firstValueFrom(http.post('/api/users', user));
      snackBar.open('User saved!', 'Dismiss', { duration: 3000 });
      this.loadUsers();  // Refresh state
    }
  }))
);
```

**Maximum Component Length:**
- **Target:** < 100 lines
- **Maximum:** 150 lines
- **If longer:** Extract logic to store/service

**Enforcement:**
- Code reviews must reject PRs with business logic in components
- Components should only import their store + UI dependencies
- If a component has more than 3 method definitions, it likely has too much logic

### 1.3 Control Flow Syntax (MANDATORY)

**NEVER use legacy structural directives (*ngIf, *ngFor, *ngSwitch).** Use Angular 17+ control flow.

**INCORRECT - Legacy:**
```html
<div *ngIf="isLoading">Loading...</div>
<div *ngFor="let item of items">{{ item.name }}</div>
```

**CORRECT - Control Flow:**
```html
@if (isLoading) {
  <div>Loading...</div>
}

@for (item of items; track item.id) {
  <div>{{ item.name }}</div>
} @empty {
  <div>No items found</div>
}

@switch (status) {
  @case ('active') { <span>Active</span> }
  @case ('inactive') { <span>Inactive</span> }
  @default { <span>Unknown</span> }
}
```

**Key Control Flow Features:**
- `@if ()` - Conditional rendering
- `@else if ()` / `@else` - Conditional branches
- `@for ()` - Looping with mandatory `track` expression
- `@empty` - Empty state for @for
- `@switch` / `@case` / `@default` - Switch statements
- `@defer` - Deferred loading (see Section 4)

### 1.4 Signals-First Architecture (MANDATORY)

**NEVER use BehaviorSubject or RxJS for component-local state.** Use Angular Signals.

**INCORRECT - Legacy RxJS:**
```typescript
export class BadComponent {
  private isLoading$ = new BehaviorSubject<boolean>(false);
  isLoading = this.isLoading$.asObservable();
  
  setLoading(value: boolean) {
    this.isLoading$.next(value);
  }
}
```

**CORRECT - Signals:**
```typescript
export class GoodComponent {
  // Writable signals for local state
  isLoading = signal(false);
  
  // Computed signals for derived state
  buttonText = computed(() => this.isLoading() ? 'Loading...' : 'Submit');
  
  // Effect for side effects
  constructor() {
    effect(() => {
      console.log('Loading state changed:', this.isLoading());
    });
  }
}
```

**Signal Types:**
- `signal<T>(initialValue)` - Writable signal
- `computed(() => ...)` - Read-only derived signal
- `effect(() => ...)` - Side effect execution
- `input.required<T>()` / `input<T>(default)` - Component inputs (v16.1+)
- `output<T>()` - Component outputs (v16.1+)
- `model<T>()` - Two-way binding (v17+)

### 1.5 Input/Output with Signals (MANDATORY)

**Use signal-based inputs/outputs instead of @Input/@Output decorators:**

```typescript
export class ModernComponent {
  // Signal inputs (Angular 16.1+)
  userId = input.required<string>();           // Required input
  pageSize = input<number>(10);                  // Input with default
  
  // Signal outputs (Angular 16.1+)
  saveClicked = output<void>();
  itemSelected = output<{ id: string; name: string }>();
  
  // Computed from input
  userProfileUrl = computed(() => `/users/${this.userId()}`);
}
```

**Template usage:**
```html
<app-modern-component 
  [userId]="currentUserId"
  [pageSize]="20"
  (saveClicked)="onSave()"
  (itemSelected)="onItemSelect($event)" />
```

---

## 2. RxJS Standards

### 2.1 When to Use RxJS

**Use RxJS for:**
- HTTP requests
- Event streams (WebSocket, user input)
- Cross-component communication via services
- Complex async orchestration

**DO NOT use RxJS for:**
- Component-local state (use Signals)
- Simple boolean flags (use Signals)
- Form validation (use Angular Forms)
- Simple value transformations (use computed())

### 2.2 RxJS Best Practices

**Always use takeUntilDestroyed():**
```typescript
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export class MyComponent {
  private http = inject(HttpClient);
  
  ngOnInit() {
    this.http.get('/api/data')
      .pipe(takeUntilDestroyed(this.destroyRef))  // ✅ Auto-cleanup
      .subscribe(data => this.data.set(data));
  }
}
```

**Use async pipe with toSignal() for templates:**
```typescript
import { toSignal } from '@angular/core/rxjs-interop';

export class MyComponent {
  private http = inject(HttpClient);
  
  // Convert Observable to Signal for template
  users = toSignal(this.http.get<User[]>('/api/users'), { initialValue: [] });
}
```

**Prefer switchMap over nested subscriptions:**
```typescript
// ✅ Good - Flattened with switchMap
searchResults = toSignal(
  this.searchTerm$.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap(term => this.http.get(`/api/search?q=${term}`))
  ),
  { initialValue: [] }
);

// ❌ Bad - Nested subscription
this.searchTerm$.subscribe(term => {
  this.http.get(`/api/search?q=${term}`).subscribe(results => {
    this.results.set(results);
  });
});
```

---

## 3. NgRx Standards

### 3.1 NgRx SignalStore (MANDATORY for new code)

**NEVER use traditional NgRx Store (actions, reducers, effects) for new code.** Use SignalStore.

**Correct - SignalStore:**
```typescript
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

export interface UserState {
  users: User[];
  selectedUserId: string | null;
  loading: boolean;
}

const initialState: UserState = {
  users: [],
  selectedUserId: null,
  loading: false
};

export const UserStore = signalStore(
  withState(initialState),
  withComputed((state) => ({
    selectedUser: computed(() => 
      state.users().find(u => u.id === state.selectedUserId())
    ),
    userCount: computed(() => state.users().length)
  })),
  withMethods((state, userService = inject(UserService)) => ({
    async loadUsers() {
      patchState(state, { loading: true });
      const users = await firstValueFrom(userService.getUsers());
      patchState(state, { users, loading: false });
    },
    selectUser(id: string) {
      patchState(state, { selectedUserId: id });
    }
  }))
);
```

**Usage in Component:**
```typescript
@Component({
  providers: [UserStore]  // Component-scoped store
})
export class UserComponent {
  store = inject(UserStore);
}
```

```html
@if (store.loading()) {
  <mat-spinner />
}

@for (user of store.users(); track user.id) {
  <div (click)="store.selectUser(user.id)">{{ user.name }}</div>
}

@if (store.selectedUser()) {
  <user-detail [user]="store.selectedUser()!" />
}
```

### 3.2 SignalStore Feature Pattern

For reusable store logic, use the feature pattern:

```typescript
export function withEntities<Entity>() {
  return signalStoreFeature(
    withState({ entities: [] as Entity[], selectedId: null as string | null }),
    withComputed((state) => ({
      selectedEntity: computed(() => 
        state.entities().find(e => e.id === state.selectedId())
      )
    })),
    withMethods((state) => ({
      selectEntity(id: string) {
        patchState(state, { selectedId: id });
      },
      setEntities(entities: Entity[]) {
        patchState(state, { entities });
      }
    }))
  );
}
```

---

## 4. Performance Features

### 4.1 Deferrable Views (@defer)

Use @defer for lazy loading below-the-fold content:

```html
@defer (on viewport) {
  <heavy-chart [data]="chartData()" />
} @placeholder {
  <div class="chart-placeholder">Chart loading...</div>
} @loading (minimum 500ms) {
  <mat-spinner />
} @error {
  <div>Failed to load chart</div>
}
```

**Trigger conditions:**
- `on viewport` - When element enters viewport
- `on idle` - When browser is idle
- `on immediate` - Right away (background)
- `on timer(2s)` - After delay
- `on interaction` - On user interaction
- `on hover` - On mouse hover

### 4.2 OnPush Change Detection (MANDATORY)

**Always use OnPush:**

```typescript
@Component({
  selector: 'app-optimized',
  changeDetection: ChangeDetectionStrategy.OnPush,  // ✅
  imports: [CommonModule],
  // ...
})
export class OptimizedComponent {
  data = input.required<string>();
  
  // With OnPush, only updates when inputs change or Signals update
}
```

### 4.3 Zoneless Applications (Angular 18+)

Consider zoneless for new applications:

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection()  // No Zone.js
  ]
};
```

**Requirements for zoneless:**
- All components use OnPush
- Use Signals for all state
- Manual change detection when needed (`ChangeDetectorRef.markForCheck()`)

---

## 5. TypeScript Standards

### 5.1 Strict Type Safety

- Enable `strict: true` in tsconfig.json
- No `any` types (use `unknown` with type guards)
- Explicit return types on public methods
- Use `satisfies` operator for type checking

```typescript
// ✅ Good - satisfies operator
const config = {
  apiUrl: '/api',
  timeout: 5000
} satisfies AppConfig;

// ✅ Good - Type guards
function isUser(obj: unknown): obj is User {
  return obj && typeof (obj as User).id === 'string';
}

// ❌ Bad - any
function process(data: any) { ... }
```

### 5.2 Dependency Injection

Always use `inject()` function, not constructor injection:

```typescript
export class ModernService {
  private http = inject(HttpClient);           // ✅
  private router = inject(Router);
  private store = inject(UserStore);
  
  // ❌ Old constructor pattern - don't use
  // constructor(private http: HttpClient) {}
}
```

### 5.3 Function-based Guards and Resolvers

```typescript
// ✅ Modern functional guard
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  
  return auth.isAuthenticated() || router.createUrlTree(['/login']);
};

// ✅ Modern functional resolver
export const userResolver: ResolveFn<User> = (route) => {
  const userService = inject(UserService);
  return userService.getUser(route.paramMap.get('id')!);
};
```

---

## 6. Material Design Standards

### 6.1 Angular Material Components

Use the M3 (Material You) design system:

```typescript
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

@Component({
  imports: [MatButtonModule, MatCardModule]
})
```

### 6.2 Component Density

```typescript
// Global density configuration
@NgModule({
  providers: [
    provideAnimations(),
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { subscriptSizing: 'dynamic' }
    }
  ]
})
```

---

## 7. Testing Standards

### 7.1 Component Testing with Signals

```typescript
it('should update count when button clicked', () => {
  const fixture = TestBed.createComponent(CounterComponent);
  const component = fixture.componentInstance;
  
  // Signals work in tests
  expect(component.count()).toBe(0);
  
  component.increment();
  fixture.detectChanges();
  
  expect(component.count()).toBe(1);
});
```

### 7.2 SignalStore Testing

```typescript
it('should load users', async () => {
  const store = TestBed.inject(UserStore);
  
  expect(store.loading()).toBe(false);
  
  await store.loadUsers();
  
  expect(store.users().length).toBeGreaterThan(0);
  expect(store.loading()).toBe(false);
});
```

---

## 8. File Naming Conventions

```
components/
├── user-profile/
│   ├── user-profile.component.ts
│   ├── user-profile.component.html
│   ├── user-profile.component.scss
│   └── user-profile.component.spec.ts

services/
├── user.service.ts
├── user.service.spec.ts

stores/
├── user.store.ts  (SignalStore)

interfaces/
├── user.interface.ts

guards/
├── auth.guard.ts

resolvers/
├── user.resolver.ts

pipes/
├── currency.pipe.ts
├── currency.pipe.spec.ts
```

---

## 9. Quick Reference: Old vs New Patterns

| Old Pattern | New Pattern (Use This) |
|-------------|------------------------|
| `*ngIf` | `@if ()` |
| `*ngFor` | `@for ()` with `track` |
| `*ngSwitch` | `@switch` / `@case` |
| `@Input()` | `input()` / `input.required()` |
| `@Output()` | `output()` |
| `standalone: true` | **Default - omit entirely** |
| `BehaviorSubject` | `signal()` |
| `constructor(private http: HttpClient)` | `private http = inject(HttpClient)` |
| NgRx Store (Actions/Reducers) | NgRx SignalStore |
| `async` pipe | `toSignal()` |
| `OnDestroy` + `Subject` | `takeUntilDestroyed()` |
| Large monolithic component | Separate .ts/.html/.scss files |
| Small component (≤10 lines) | Inline template/styles allowed |
| Default change detection | `OnPush` |
| `ngOnInit` | Constructor + `effect()` |

---

## 10. Migration Checklist

When updating legacy code:

- [ ] **Extract all business logic from component to SignalStore** (MOST IMPORTANT)
- [ ] Split monolithic components into separate files
- [ ] Replace *ngIf with @if
- [ ] Replace *ngFor with @for (add track expression)
- [ ] Replace *ngSwitch with @switch
- [ ] Replace @Input/@Output with input()/output()
- [ ] Replace BehaviorSubject with signal()
- [ ] Replace constructor injection with inject()
- [ ] Add OnPush change detection
- [ ] Remove `standalone: true` (now default)
- [ ] Replace NgRx Store with SignalStore (for local state)
- [ ] Add takeUntilDestroyed() to subscriptions
- [ ] Remove async pipe (use toSignal)

---

**Enforcement:** These rules are mandatory for all new code. Legacy code should be migrated during feature work or dedicated refactoring sprints.
