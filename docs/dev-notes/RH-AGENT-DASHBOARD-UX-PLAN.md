# RH Agent Dashboard UX Enhancement Plan

## Current Issues Identified
- **Limited real estate**: Two-column layout cramps signals and decision panels
- **No dedicated space for charts**: Future chart embedding would require major redesign
- **Compact signal cards**: Limited detail visibility and quick decision-making
- **Decision panels compete for space**: Accepted/Considered/Rejected panels are cramped

## Proposed Solution: Adaptive Master-Detail Layout

### Single Page: Unified Opportunity Review Interface
**Purpose**: Run selection, opportunity triage, detailed analysis, and execution in one unified interface

#### Desktop-First Layout Strategy

**Primary Layout (>1400px)**
- **List Panel (25%)**: Filterable signal list with ACR status
- **Detail Panel (75%)**: Chart area, signal details, controls
- **Chart Size**: 700x450px placeholder for future implementation

**Secondary Layout (1200-1400px)**
- **List Panel (30%)**: Compact signal list for smaller monitors
- **Detail Panel (70%)**: Chart area (600x400px) placeholder

#### Key Components

**1. Current Opportunities Header**
- Latest data fetch timestamp
- Signal count summary
- Manual calculation trigger

**2. Filter & Action Toolbar**
- Basic filtering (symbols, signal types)
- Export controls

**3. Master List Panel**
- Sortable signal list with key metrics
- Real-time ACR status indicators
- Click to select signal for detailed view
- Keyboard navigation support

**4. Detail Panel**
- **Chart Area (80% of detail)**: Chart placeholder for future technical analysis
- **Signal Info (15%)**: Metadata, indicators, reasoning
- **Action Controls (5%)**: ACR buttons (Accept/Consider/Reject)

**5. Execution Section**
- Accepted opportunities summary
- Portfolio allocation controls
- Claude prompt generation
- Copy-to-clipboard functionality

#### Key Features
- **Real-time data**: Focus on most recent signals and opportunities
- **Quick triage**: Rapid ACR decisions for immediate trade execution
- **Chart placeholder**: Dedicated space reserved for future implementation
- **Real-time synchronization**: ACR decisions instantly reflected
- **Keyboard shortcuts**: Power user navigation

## Technical Considerations

### Data Architecture
- **Data fetch vs calculation separation**: SA fetches data and makes it available, user triggers calculation on most recent fetch
- **Data freshness**: Signals reflect most recent SA data fetch, not live market data
- **Transient signal handling**: Signals may change/disappear quickly intraday

### Desktop-First Design
- **CSS Grid/Flexbox**: Fixed layout for desktop screens
- **Breakpoint**: 1200px minimum for optimal experience
- **Panel sizing**: Fixed 25/75 split for maximum chart space

### State Management
- **Single page state**: No navigation state to manage
- **Real-time synchronization**: ACR decisions instantly reflected
- **Current signal selection**: Track which signal is displayed in detail panel
- **Session-based filters**: Basic filter state during current session

### Performance Optimizations
- **Virtual scrolling**: For large opportunity lists (100+ signals)
- **Signal data caching**: Pre-load signal metadata for smooth transitions
- **Background processing**: Calculate signals when user triggers

## Implementation Priority (MVP Focus)
1. **Phase 1**: Core master-detail layout with chart placeholders
2. **Phase 2**: Data fetch and manual calculation trigger
3. **Phase 3**: Signal selection and ACR functionality
4. **Phase 4**: Basic filtering and keyboard shortcuts
5. **Phase 5**: Claude prompt generation and execution features

### Future Phases (Post-MVP)
- Chart integration with technical indicators
- Historical runs and backtesting
- Performance metrics and statistics
- Advanced filtering and persistence

## Benefits
- **No navigation friction**: Everything in one view
- **Chart-ready**: Dedicated space prepared for future implementation
- **Professional workflow**: Optimized for chart observation tasks
- **Desktop focus**: Maximum screen real estate for analysis
- **Clean architecture**: Easy chart integration when ready

## File Structure Impact
```
src/app/features/rh-agent/
├── components/
│   ├── master-detail-dashboard/
│   │   ├── master-detail-dashboard.component.ts
│   │   ├── master-detail-dashboard.component.html
│   │   ├── master-detail-dashboard.component.scss
│   │   ├── signal-list.component.ts
│   │   ├── signal-detail.component.ts
│   │   ├── chart-placeholder.component.ts
│   │   └── execution-panel.component.ts
├── services/
│   ├── signal-selection.service.ts
│   ├── filter.service.ts
│   └── claude-prompt.service.ts
└── models/
    ├── signal-list.model.ts
    ├── signal-detail.model.ts
    └── chart-data.model.ts (prepared for future)
```

## Existing Dashboard Transformation (MVP)

### Simplified Current Dashboard
The existing dashboard focuses on immediate data management:

**1. Data Management**
- Data fetch status and timestamp
- Manual calculation trigger ("Run Now")
- Current signal count and status

**2. Navigation to Review Interface**
- **Primary "Review Opportunities" button** when signals are available
- Direct access to current opportunities for immediate action

### Navigation Flow (MVP)
```
Existing Dashboard (Data Management)
├── Data Status
│   ├── Last fetch: 2:30 PM
│   ├── Signals ready: 47 opportunities
│   └── [Calculate Now] → Generate signals
├── Review Section
│   └── [Review Opportunities] → New Master-Detail UI
└── Agent Controls
    ├── [Refresh Data]
    └── [Calculate Now]
```

### Access Point to New UI

**Single Access Point - Current Opportunities**
- "Review Opportunities" button appears when signals are calculated
- Opens master-detail interface with current signals
- Focus on immediate trade execution

### URL Structure (MVP)
```
/rh-agent/dashboard (existing - data management)
/rh-agent/review (new master-detail interface - current signals only)
```

### State Management (MVP)
- **Current session focus**: Only most recent signals from latest SA fetch
- **Data freshness**: Based on SA fetch timestamp, not live market data
- **Immediate action**: Quick path from signal to trade execution

This MVP approach focuses on the primary goal: quickly review current opportunities and build trade lists for immediate execution.

## Implementation Plan

### Phase 1: Foundation & Data Architecture

**1.1 Data Layer Setup** (NEW - needs implementation)
- Extend existing `RhAgentService` with data fetch/calculation separation
- Create new data models for signal list and detail views
- Implement SA data fetch integration
- Add manual calculation trigger functionality

**1.2 State Management** (NEW - needs implementation)
- Create new store for master-detail UI state
  - **Selected signal ID**: Which signal is currently displayed in detail panel
  - **Filter state**: Symbol search text, selected signal types
  - **List scroll position**: Maintain scroll when navigating back to list
  - **Panel sizes**: User-adjusted list/detail panel widths (if implemented)
  - **Sort configuration**: Current sort column and direction
- Integrate with existing `RhAgentStore` for data
- Implement signal selection tracking
- Add ACR decision state management

**1.3 Routing & Navigation**
- Add new route `/rh-agent/review` 
- Update existing dashboard with "Review Opportunities" button
- Implement navigation between dashboard and review interface

### Phase 2: Core Master-Detail Layout

**2.1 Main Component Structure**
- Create `MasterDetailDashboardComponent` as the main container
- Implement CSS Grid layout with 25/75 split
- Add responsive breakpoint handling (1200px+)

**2.2 List Panel Component**
- Create `SignalListComponent` for the master list
- Implement virtual scrolling for performance
- Add basic sorting (symbol, signal type, direction)
- Add click handlers for signal selection

**2.3 Detail Panel Component**
- Create `SignalDetailComponent` for the detail view
- Implement chart placeholder (700x450px)
- Add signal metadata display
- Add ACR action buttons (Accept/Consider/Reject)

**2.4 Execution Panel Component**
- Create `ExecutionPanelComponent` for trade generation
- Implement accepted opportunities summary
- Add portfolio allocation controls
- Add Claude prompt generation functionality

### Phase 3: Interactions & Functionality

**3.1 Signal Selection & Navigation**
- Implement click-to-select signal behavior
- Add keyboard navigation (arrow keys, enter)
- Add Previous/Next navigation buttons
- Sync selection between list and detail panels

**3.2 ACR Decision System**
- Implement Accept/Consider/Reject actions
- Add visual feedback for decisions
- Sync decisions back to data store
- Update list panel to show decision status

**3.3 Basic Filtering**
- Add symbol filter (search input)
- Add signal type filter (chips)
- Implement filter persistence within session
- Add clear filters functionality

**3.4 Keyboard Shortcuts**
- Implement A=Accept, C=Consider, R=Reject shortcuts
- Add arrow key navigation
- Add Enter key for detail view
- Add Escape key for clear selection

### Phase 4: Integration & Polish

**4.1 Dashboard Integration**
- Update existing dashboard with data fetch status
- Add "Calculate Now" button functionality
- Add "Review Opportunities" button with signal count
- Implement navigation flow between pages

**4.2 Data Flow Integration**
- Connect data fetch service to UI components
- Implement real-time signal updates
- Add error handling and loading states
- Add data refresh functionality

**4.3 Claude Prompt Generation**
- Integrate with existing Robinhood trade service
- Implement batch prompt generation
- Add individual trade prompt generation
- Add copy-to-clipboard functionality

**4.4 UI Polish & Testing**
- Add loading states and skeleton screens
- Implement error handling and user feedback
- Add accessibility features (ARIA labels, focus management)
- Test with large signal sets (100+ signals)

### Development Dependencies

**Prerequisites**
- Existing RH Agent dashboard must be functional
- Data fetch/calculation backend services available
- Robinhood trade service integration ready

**Parallel Development Tracks**
- Track A: Data layer & state management
- Track B: UI components & layout
- Track C: Integration & navigation

**Integration Points**
- Dashboard → Review interface navigation
- Data service → UI components data flow
- ACR decisions → Claude prompt generation
- Signal selection → Detail panel updates

### Risk Mitigation

**Technical Risks**
- Large signal set performance → Virtual scrolling implementation
- Real-time data updates → Debounced updates and caching
- State synchronization → Single source of truth pattern

**User Experience Risks**
- Complex navigation → Clear visual hierarchy and breadcrumbs
- Data loss → Auto-save and session persistence
- Confusing ACR flow → Clear visual feedback and undo functionality

### Success Metrics

**Performance**
- < 100ms response time for signal selection
- Smooth scrolling with 1000+ signals
- < 2 second load time for initial data

**Usability**
- Complete ACR workflow in < 5 minutes
- Zero navigation errors in user testing
- Intuitive keyboard shortcut adoption

**Functionality**
- 100% signal decision sync accuracy
- Reliable Claude prompt generation
- Seamless dashboard integration

This implementation plan provides a clear path from foundation to full MVP functionality while maintaining flexibility for future chart integration and feature additions.

This desktop-focused master-detail approach maximizes chart observation space while maintaining a clean architecture for future chart integration.
