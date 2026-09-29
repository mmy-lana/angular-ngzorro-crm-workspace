# angular-ngzorro-crm-workspace

An enterprise-grade Customer Relationship Management (CRM) Console Workspace built with Angular and NG-ZORRO (Ant Design Angular). Modeled after the Salesforce Lightning Console and Financial Services Cloud architectures, this workspace provides a high-density, multi-document tabbed interface with optimistic concurrency, cross-tab data synchronization, and responsive adaptation across desktop, tablet, and mobile viewports.

* Live Demo: https://angular-ngzorro-crm-workspace.vercel.app
* Source Repository: https://github.com/mmy-lana/angular-ngzorro-crm-workspace

---

## Architectural Highlights

* Multi-Document Keep-Alive Console: Tabs are persisted in `sessionStorage` and retain full component state across tab switches via an outlet pool with hidden states, preventing form destruction or loss of scroll position.
* Reactivity via Angular Signals: Core stores, derived rollups, computed counts, and responsive viewport states leverage Angular Signals, `computed`, and `effect`.
* Offline-First & Cross-Tab Synchronization: Features a local storage engine equipped with an in-memory fallback map, `BroadcastChannel` multi-window replication, and tombstone tracking to prevent phantom record resurrection.
* Salesforce High-Density Layout: Fine-pointer density overrides deliver 24px button heights, 4px by 8px table cell padding, and concise metric chips, while dynamically expanding to 44px tap targets for coarse-pointer devices (WCAG 2.5.5).
* Disjunctive Keyword Search Engine: Text search evaluates disjunctively (`OR` across candidate columns) while preserving conjunctive logic (`AND`) for structured filters such as Stage and Rating.

---

## Domain Models & Business Invariants

The CRM domain model enforces strict relational rules across all mutations:

* Accounts: Primary organizational entity tracking annual revenue, risk ratings (`HOT`, `WARM`, `COLD`), industry classification, billing addresses, and shipping locations.
* Contacts: Stakeholders associated with an Account. Enforces at most one primary contact per account. Setting a contact as primary automatically demotes sibling contacts in the same signal update. Contact deletion is blocked if referenced as `primaryContactId` by any opportunity.
* Opportunities (Deals): Follows an 8-stage pipeline path (`Prospecting` to `Closed Won` / `Closed Lost`). Moving to `Closed Lost` requires a mandatory loss reason. Expected revenue is computed as `Math.round(amount * (probability / 100))`. Reopening an opportunity normalizes past close dates to the current calendar date.
* Activities: Tasks, calls, meetings, emails, and notes linked to Accounts, Opportunities, or Contacts. Marking an activity complete automatically records an ISO completion timestamp, while reverting clears it.
* Optimistic Locking: Every mutable record tracks an integer `version`. Mutations verify expected versions and raise `ConflictError` upon concurrent modifications.

---

## Feature Overview

### 1. Executive Pipeline Dashboard
* Real-time metrics ribbon: Total Pipeline, Weighted Forecast, Closed Won, Win Rate, Overdue Count, and Deals Due This Month.
* CSS-based pipeline stage distribution bars with relative capacity scaling.
* Forecast roll-up summary table categorizing deals by `Pipeline`, `Best Case`, `Commit`, `Closed Won`, and `Omitted`.
* 30-day closing deal watch-list with direct record links.

### 2. Tabbed Console Shell
* Primary object launcher dropdown providing instant access to the Dashboard, Master Accounts directory, and Master Opportunities pipeline.
* Multi-document tab strip with dirty status dot indicators, tab close guards with discard confirmation modals, and overflow menus for inactive tabs.
* Integrated bottom utility bar with entity counters, active pane scrolling, and global quick-create triggers.

### 3. Master Entity Directories
* Account List: Searchable, multi-column sortable table with column visibility picker, rating filter chips, and pagination.
* Opportunity List: Stage-filtered pipeline table showing probability percentages, weighted revenue calculations, and overdue indicators.
* Responsive card streams automatically replace data grids on screen widths below 768px.

### 4. Record Detail Workspaces
* Highlights banner presenting key metrics, entity status icons, and action clusters.
* 8-step interactive chevron ribbon (`StagePathComponent`) supporting mobile bottom-sheet stage transitions.
* Detail sub-tabs separating core field definitions, related entity cards, and chronological activity feeds.

### 5. Universal Quick-Create Drawer
* Single-instance slide-out drawer handling creation and inline editing for Accounts, Contacts, Opportunities, and Activities.
* Context-aware pre-filling: Creating a contact from an account automatically binds foreign keys and scopes primary status options.

---

## Global Keyboard Shortcuts

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| `Alt + Shift + W` | Global Shell | Closes the currently active console tab (prompts if dirty). |
| `Ctrl + S` / `Cmd + S` | Detail Views | Saves the active record form (suppressed in background panes). |
| `/` | Global Shell | Contextual search trigger (routes to relevant list and focuses input). |

---

## Tech Stack

* Framework: Angular (Standalone Components, Signals, New Control Flow)
* UI Components: NG-ZORRO (`ng-zorro-antd`)
* Iconography: `@ant-design/icons-angular`
* Styling: SCSS with Salesforce Lightning Design System (SLDS) custom properties
* Responsive Layout: `@angular/cdk/layout` (`BreakpointObserver`)
* State & Concurrency: Angular Signals, RxJS, Web BroadcastChannel API, Web Crypto API
* Package Manager: `pnpm`
* Tooling: Angular CLI with Vite/Application Builder

---

## Project Structure

```
src/
├── app/
│   ├── core/
│   │   ├── fixtures/          # Deterministic seed data (FNV-1a hashed UUIDs)
│   │   ├── models/            # Domain interfaces, enums, and form models
│   │   ├── services/          # Repository, Storage, Tab, Viewport, and Shortcut services
│   │   ├── tokens/            # Storage tokens and syncable key definitions
│   │   └── utils/             # Pipeline math, filter evaluation, and CSPRNG UUID generator
│   ├── features/
│   │   ├── accounts/          # Account list and detail views
│   │   ├── activities/        # Activity composer and timeline integration
│   │   ├── opportunities/     # Opportunity list, detail, and loss-reason modal
│   │   └── workspace/         # Console shell, tab bar, utility bar, and dashboard
│   ├── shared/
│   │   ├── pipes/             # Compact currency and stage color pipes
│   │   └── ui/                # Reusable UI primitives (badges, chips, stage path, cards, toolbar)
│   ├── app.component.ts       # Root host component
│   └── app.config.ts          # Application providers, icons, and native date adapter config
├── styles/
│   ├── _density-overrides.scss# High-density desktop and 44px coarse-pointer rules
│   └── _theme-variables.scss  # SLDS palette and stage color tokens
├── index.html                 # Viewport cover configuration
├── main.ts                    # Application bootstrap
└── styles.scss                # Global layout locks and baseline typography
```

---

## Local Development

### Prerequisites
* Node.js: `>= 20.0.0`
* Package Manager: `pnpm` (`npm install -g pnpm`)

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/mmy-lana/angular-ngzorro-crm-workspace.git
cd angular-ngzorro-crm-workspace
pnpm install
```

### Development Server
Run the local dev server:
```bash
pnpm dev
```
Navigate to `http://localhost:4200/`. The application will automatically reload if you change any source files.

### Build
Compile the production artifacts:
```bash
pnpm run build
```
Build outputs will be emitted to `dist/angular-ngzorro-crm-workspace`.

### Linting
Run static code analysis:
```bash
pnpm run lint
```

---

## Environment Configuration

Copy `.env.example` to `.env` to customize runtime parameters:

```env
CRM_APP_NAME="angular-ngzorro-crm-workspace"
CRM_APP_ENV="development"

# Controls whether empty storage initializes with the 10-account demo dataset.
# Set to "false" in production environments to prevent test record contamination.
CRM_SEED_DEMO_DATA="true"
```

---

## Verification Standards

* Concurrency Testing: Deleting a record in Window A emits an indexed tombstone (`CRM_STORAGE_KEYS.TOMBSTONES`). Sibling windows adopt the tombstone and prevent record resurrection during incoming version merges.
* Responsive Audit: Validated across 360px, 390px, 430px (mobile card streams), 768px (tablet priority tab bar), and 1024px+ (desktop data-dense console).
* Zero UTC Skew: Calendar operations use `toLocalDateOnly()` to prevent timezone shifts across non-UTC date comparisons.
