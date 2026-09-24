# Implementation Plan: PawPort

## Overview

PawPort is a mobile-first SaaS platform for solo mobile pet groomers built with Next.js 14+ App Router, TypeScript, MongoDB, Stripe, and Google Calendar integration. Implementation follows a layered approach: foundational infrastructure first, then public-facing booking flow, then private groomer portal, and finally polish and analytics.

## Tasks

- [ ] 1. Project Setup, Theme System, and Layout
  - [ ] 1.1 Initialize Next.js project with TypeScript, Tailwind CSS, DaisyUI, and configure path aliases
    - Create the Next.js 14+ project with App Router
    - Install dependencies: tailwindcss, daisyui, framer-motion, next-themes, sonner, lucide-react
    - Configure `tailwind.config.ts` with custom DaisyUI themes (pawport_light, pawport_dark), font family (Inter/Geist), rounded-2xl cards, and shadow tokens
    - Configure `src/app/globals.css` with Tailwind directives
    - _Requirements: 18.1, 18.5, 18.6_

  - [ ] 1.2 Create ThemeProvider, ToastProvider, and root layout with providers
    - Implement `src/components/providers/ThemeProvider.tsx` using next-themes with `data-theme` attribute
    - Implement `src/components/providers/ToastProvider.tsx` using sonner with 5s auto-dismiss for success, persistent for errors, max 3 visible
    - Create `src/app/layout.tsx` wrapping SessionProvider, ThemeProvider, ToastProvider
    - _Requirements: 18.2, 18.3, 18.4, 19.5, 19.6_

  - [ ] 1.3 Create shared UI primitives and page transition components
    - Implement `src/components/ui/PageTransition.tsx` with Framer Motion (200-400ms transitions)
    - Create loading skeleton component for data fetching states (display within 200ms)
    - Create empty state component with label and suggested action
    - Create responsive container and card components with rounded-2xl and soft shadow
    - _Requirements: 18.7, 19.3, 19.4_

  - [ ] 1.4 Create route group layouts for (auth), (portal), and (public)
    - Implement `src/app/(auth)/layout.tsx` — centered card layout for login/register
    - Implement `src/app/(portal)/layout.tsx` — sidebar navigation with theme toggle, mobile hamburger menu
    - Implement `src/app/(public)/layout.tsx` — minimal public-facing layout
    - Ensure mobile-first breakpoints: 767px, 768-1023px, 1024px+ with 44x44px touch targets
    - _Requirements: 19.1, 19.2_

- [ ] 2. Authentication System
  - [ ] 2.1 Configure NextAuth.js with Credentials and Google OAuth providers
    - Create `src/lib/auth/config.ts` with JWT strategy, 7-day session, custom pages
    - Implement credentials authorize with bcrypt password verification
    - Implement account lockout after 5 failed attempts for 30 minutes
    - Add JWT and session callbacks to include userId, onboardingComplete, groomerSlug
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_

  - [ ] 2.2 Create auth middleware for route protection
    - Implement `src/middleware.ts` using next-auth/middleware
    - Redirect unauthenticated users from portal routes to /login
    - Redirect authenticated users with incomplete onboarding to /onboarding
    - Allow public routes (/book/*, /pet-card/*) without auth
    - _Requirements: 1.5_

  - [ ] 2.3 Implement registration and login server actions with Zod validation
    - Create `src/lib/validators/auth.ts` with Zod schemas (password: min 8, uppercase, lowercase, digit)
    - Create `src/actions/auth.ts` with registerGroomer and loginGroomer actions
    - Implement generic error messages (no email leak on duplicate)
    - Create User + GroomerProfile on registration, redirect to onboarding
    - _Requirements: 1.1, 1.4, 1.7_

  - [ ] 2.4 Build registration and login page UI
    - Create `src/app/(auth)/register/page.tsx` with React Hook Form + Zod
    - Create `src/app/(auth)/login/page.tsx` with React Hook Form + Zod
    - Implement inline validation errors, generic server error display
    - Add Google OAuth sign-in button
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 21.1, 21.2, 21.3_

  - [ ]* 2.5 Write property test for password validation
    - **Property 9: Registration password validation**
    - **Validates: Requirements 1.1**

- [ ] 3. Database Models and Connection
  - [ ] 3.1 Set up MongoDB connection singleton and base configuration
    - Create `src/lib/db/connect.ts` with cached connection pattern and maxPoolSize: 10
    - Configure MONGODB_URI environment variable
    - _Requirements: 22.1, 22.4_

  - [ ] 3.2 Implement User and GroomerProfile Mongoose models
    - Create `src/lib/db/models/user.ts` with email uniqueness, role, lockout fields, timestamps
    - Create `src/lib/db/models/groomer-profile.ts` with slug uniqueness, availability windows, estimate rules, blocked dates, all indexes
    - _Requirements: 22.1, 22.4, 22.5, 22.6_

  - [ ]* 3.3 Write property test for groomer slug validation
    - **Property 10: Groomer slug uniqueness and format**
    - **Validates: Requirements 15.5, 15.6**

  - [ ] 3.4 Implement Client, Pet, and Service Mongoose models
    - Create `src/lib/db/models/client.ts` with compound unique index (groomerId + email), text search index
    - Create `src/lib/db/models/pet.ts` with all pet fields, digitalCardId (sparse unique), indexes
    - Create `src/lib/db/models/service.ts` with price/duration constraints, isActive flag
    - _Requirements: 22.1, 22.2, 22.5, 22.6_

  - [ ] 3.5 Implement Appointment and Transaction Mongoose models
    - Create `src/lib/db/models/appointment.ts` with status enum, date indexes, population refs
    - Create `src/lib/db/models/transaction.ts` with Stripe payment reference, status enum
    - _Requirements: 22.1, 22.2, 22.4, 22.5_

  - [ ] 3.6 Implement shared TypeScript interfaces and type definitions
    - Create `src/types/index.ts` with all shared interfaces (EstimateInput, EstimateResult, TimeSlot, BookingPayload, etc.)
    - Create enum types for temperament, coat condition, appointment status, transaction status
    - _Requirements: 22.1_

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Estimate Engine and Availability Logic
  - [ ] 5.1 Implement the Estimate Engine
    - Create `src/lib/estimate/engine.ts` with calculateEstimate function
    - Implement base coat multipliers, weight tier multipliers, custom rule application
    - Clamp total adjustment to -50% to +50%, return min/max range (90%/110% of base)
    - Ensure minPrice > 0, round to 2 decimal places
    - _Requirements: 5.2, 5.3_

  - [ ]* 5.2 Write property tests for Estimate Engine
    - **Property 1: Estimate Engine produces valid price range**
    - **Validates: Requirements 5.2, 5.3**

  - [ ]* 5.3 Write property test for Estimate Engine monotonicity
    - **Property 2: Estimate Engine monotonicity with weight**
    - **Validates: Requirements 5.2**

  - [ ] 5.4 Implement availability slot computation
    - Create `src/lib/calendar/availability.ts` with getAvailableSlots function
    - Generate candidate slots from recurring windows (15-min increments)
    - Filter against existing appointments, blocked dates, and Google Calendar blocks
    - Only return future available slots
    - _Requirements: 6.1, 6.2_

  - [ ]* 5.5 Write property tests for availability slots
    - **Property 3: Availability slots never overlap with blocked time**
    - **Validates: Requirements 6.1, 6.4**

  - [ ]* 5.6 Write property test for slot duration
    - **Property 4: Availability slots respect service duration**
    - **Validates: Requirements 6.1**

- [ ] 6. Public Booking Flow
  - [ ] 6.1 Implement booking flow state machine hook and container
    - Create `src/hooks/useBookingFlow.ts` with useReducer, 6 steps, GO_BACK action
    - Create `src/app/(public)/book/[groomerSlug]/page.tsx` server component to fetch groomer data
    - Create `src/components/booking/BookingFlow.tsx` client component with step rendering and progress indicator
    - Implement animated step transitions (Framer Motion, 400ms max)
    - _Requirements: 3.1, 3.5, 18.7_

  - [ ]* 6.2 Write property test for booking flow state preservation
    - **Property 6: Booking flow state preservation on back navigation**
    - **Validates: Requirements 3.6, 4.5**

  - [ ] 6.3 Implement Step 1: Pet Information form
    - Create `src/components/booking/StepPetInfo.tsx` with React Hook Form + Zod
    - Create `src/lib/validators/booking.ts` with pet info schema
    - Include all fields: name, photo upload, breed selector, weight, age, temperament, coat condition, special flags, notes
    - Implement inline validation errors without clearing valid fields
    - _Requirements: 3.2, 3.3, 3.4, 3.6_

  - [ ] 6.4 Implement Step 2: Owner Details and Service Address form
    - Create `src/components/booking/StepOwnerDetails.tsx` with React Hook Form + Zod
    - Collect: name, email, phone, street, city, state, postal code
    - Validate email format, phone length (7-15 digits), required fields
    - Retain data on back navigation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 6.5 Implement Step 3: Instant Estimate display
    - Create `src/components/booking/StepEstimate.tsx`
    - Call estimate engine server action with pet weight, coat condition, groomer rules
    - Display min-max range formatted as "$X.XX – $Y.XX"
    - Handle error case when estimate cannot be calculated
    - _Requirements: 5.1, 5.3, 5.4, 5.5_

  - [ ] 6.6 Implement Step 4: Calendar Availability and slot selection
    - Create `src/components/booking/StepCalendar.tsx`
    - Fetch available slots for next 14 days using availability engine
    - Display slots grouped by day with selectable time buttons
    - Handle no-availability case with contact message
    - _Requirements: 6.1, 6.4, 6.5_

  - [ ] 6.7 Implement tentative slot reservation system
    - Create `src/lib/calendar/reservation.ts` with Reservation model (TTL index, 10-min expiry)
    - Implement atomic check-and-reserve with session ID
    - Create server action to reserve slot on selection
    - Handle conflict when slot already reserved by another session
    - _Requirements: 6.3, 6.4_

  - [ ]* 6.8 Write property test for slot reservation atomicity
    - **Property 8: Slot reservation atomicity**
    - **Validates: Requirements 6.3, 6.4**

  - [ ] 6.9 Implement Step 5: Stripe Deposit Payment
    - Create `src/lib/stripe/client.ts` with Stripe SDK initialization
    - Create `src/lib/stripe/helpers.ts` with createDepositPaymentIntent
    - Create `src/components/booking/StepPayment.tsx` with Stripe Payment Element
    - Handle payment success, failure (retry up to 3 times), and timeout (30s)
    - Handle expired reservation (redirect to step 4)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ] 6.10 Implement Stripe webhook handler
    - Create `src/app/api/webhooks/stripe/route.ts`
    - Handle payment_intent.succeeded: create Appointment, Client, Pet, Transaction records
    - Handle payment_intent.payment_failed: update Transaction status
    - Verify webhook signature
    - _Requirements: 7.3, 7.5_

  - [ ] 6.11 Implement Step 6: Success page and confirmation emails
    - Create `src/components/booking/StepSuccess.tsx` displaying appointment details
    - Create `src/lib/email/send.ts` with email sending (Resend/SendGrid)
    - Send confirmation email to Client within 5 minutes (with 3 retries)
    - Send notification email to Groomer within 5 minutes (with 3 retries)
    - Display success page regardless of email/calendar notification success
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.7_

- [ ] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Google Calendar Integration
  - [ ] 8.1 Implement Google Calendar client and OAuth token management
    - Create `src/lib/calendar/client.ts` with Google Calendar API client
    - Implement token refresh logic using stored googleRefreshToken
    - _Requirements: 14.2_

  - [ ] 8.2 Implement bidirectional calendar sync
    - Create `src/lib/calendar/sync.ts` with syncGroomerCalendar function
    - Inbound: Fetch changed events using syncToken, mark overlapping slots as blocked
    - Outbound: Create/update Google Calendar events on booking creation and status change
    - Implement retry logic (up to 3 attempts)
    - _Requirements: 8.4, 12.3, 14.2, 14.3_

  - [ ] 8.3 Implement cron job for periodic calendar sync
    - Create `src/app/api/cron/calendar-sync/route.ts`
    - Verify CRON_SECRET authorization header
    - Sync all connected groomers, log success/failure counts
    - Configure Vercel cron for 5-minute intervals
    - _Requirements: 6.2, 14.3, 14.5_

- [ ] 9. Groomer Portal — Dashboard
  - [ ] 9.1 Implement dashboard server component and data fetching
    - Create `src/app/(portal)/dashboard/page.tsx` as server component
    - Fetch today's + next 7 days appointments, sorted ascending by date
    - Populate client name, phone, pet name, breed, service name
    - _Requirements: 9.1, 9.2_

  - [ ] 9.2 Build dashboard UI with appointment cards and status indicators
    - Create `src/components/portal/DashboardView.tsx`
    - Display appointment cards with pet name, client name, address, time, notes (truncated 100 chars), status badge
    - Add Google Maps directions link (omit if no address)
    - Add click-to-navigate to appointment detail
    - Handle empty state with "no upcoming appointments" message
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ] 10. Groomer Portal — Appointment Management
  - [ ] 10.1 Implement appointment status transition server actions
    - Create `src/actions/appointments.ts` with updateAppointmentStatus
    - Enforce valid transitions: upcoming→in-progress, upcoming→cancelled, in-progress→completed, in-progress→cancelled
    - Prompt for post-groom notes on completion (max 2000 chars)
    - Sync status change to Google Calendar (non-blocking, retry up to 3 times)
    - _Requirements: 12.1, 12.2, 12.3, 12.5_

  - [ ]* 10.2 Write property test for appointment status transitions
    - **Property 5: Appointment status transitions are valid**
    - **Validates: Requirements 12.1**

  - [ ] 10.3 Build appointments list and detail views
    - Create `src/app/(portal)/appointments/page.tsx` with list view sorted by date ascending
    - Add filtering by status and date range
    - Create `src/app/(portal)/appointments/[appointmentId]/page.tsx` with full detail and status change buttons
    - _Requirements: 12.1, 12.4_

- [ ] 11. Groomer Portal — Client Management
  - [ ] 11.1 Implement client search and CRUD server actions
    - Create `src/actions/clients.ts` with searchClients (debounced, 300ms, regex match on name/email/phone)
    - Implement pagination (50 per page)
    - Scope all results to authenticated groomer
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 11.2 Write property test for client search scoping
    - **Property 7: Client search returns only scoped results**
    - **Validates: Requirements 10.1, 10.2**

  - [ ] 11.3 Build client list and detail pages
    - Create `src/app/(portal)/clients/page.tsx` with search bar and paginated list
    - Create `src/app/(portal)/clients/[clientId]/page.tsx` with client info and linked pets
    - Implement debounced search with useDebounce hook
    - Handle empty search results state
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 12. Groomer Portal — Pet Profile Management
  - [ ] 12.1 Implement pet CRUD and card generation server actions
    - Create `src/actions/pets.ts` with getPet, updatePet, generateDigitalPetCard
    - Validate pet fields with Zod (name max 50, weight 1-200, age 0-30, required enums)
    - Implement generateDigitalPetCard: assign nanoid cardId, fetch last 5 services, calculate next recommended date
    - _Requirements: 11.1, 11.3, 11.5, 11.6_

  - [ ] 12.2 Build pet profile page with service history timeline
    - Create `src/app/(portal)/pets/[petId]/page.tsx`
    - Display all pet fields: photo, name, breed, weight, age, temperament, coat condition, flags, notes
    - Display service history in reverse chronological order (date, service type, notes, status)
    - Add edit form with inline validation
    - Add "Generate Digital Pet Card" button
    - _Requirements: 11.1, 11.2, 11.5, 11.6_

- [ ] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Digital Pet Card
  - [ ] 14.1 Implement pet card data assembly and public page
    - Create `src/app/(public)/pet-card/[cardId]/page.tsx` as server component
    - Generate SEO metadata (title: "{petName}'s Pet Card")
    - Assemble card data: pet info, last 3-5 services, next recommended date, groomer branding
    - Handle missing pet (404), no service history (omit section with message)
    - _Requirements: 17.1, 17.5, 17.6_

  - [ ] 14.2 Build PetCardRenderer component with branded styling
    - Create `src/components/pet-card/PetCardRenderer.tsx`
    - Display pet photo (or placeholder silhouette), name, breed, weight, age, temperament, coat, flags
    - Display service history entries and next recommended date
    - Display groomer logo, business name, contact info
    - Style with DaisyUI theme colors, rounded-2xl, soft shadow
    - Responsive from 320px viewport width
    - _Requirements: 17.1, 17.2, 17.5_

  - [ ] 14.3 Implement "Copy Shareable Link" and "Download as PDF" actions
    - Add copy-to-clipboard functionality with toast confirmation
    - Implement PDF generation using @react-pdf/renderer (client-side)
    - Create `src/components/pet-card/PetCardPDF.tsx` with A5 layout
    - Ensure PDF downloads within 10 seconds
    - _Requirements: 17.3, 17.4_

  - [ ]* 14.4 Write property test for Digital Pet Card data completeness
    - **Property 11: Digital Pet Card data completeness**
    - **Validates: Requirements 17.1**

- [ ] 15. Services and Pricing Management
  - [ ] 15.1 Implement service CRUD server actions
    - Create `src/actions/services.ts` with createService, updateService, deleteService, toggleServiceActive
    - Validate: name max 100, description max 500, basePrice 0.01-9999.99, duration 15-480 min
    - Prevent deletion of services with upcoming appointments
    - Support marking as inactive (hidden from booking flow)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ] 15.2 Build services management page
    - Create `src/app/(portal)/services/page.tsx`
    - Display service list with name, price, duration, active status
    - Add create/edit forms with React Hook Form + Zod validation
    - Show error when attempting to delete service with upcoming appointments
    - _Requirements: 13.1, 13.2, 13.4, 13.5_

- [ ] 16. Availability Configuration
  - [ ] 16.1 Implement availability configuration server actions
    - Create `src/actions/availability.ts` with updateAvailabilityWindows, addBlockedDate, removeBlockedDate
    - Validate: 15-min increments, end time after start time, valid day-of-week
    - _Requirements: 14.1, 14.4, 14.6_

  - [ ] 16.2 Build availability configuration page
    - Create `src/app/(portal)/availability/page.tsx`
    - Display weekly recurring windows with add/edit/delete
    - Display blocked dates list with add/remove
    - Add Google Calendar connection button and status indicator
    - Show validation errors for invalid time ranges
    - _Requirements: 14.1, 14.4, 14.5, 14.6_

- [ ] 17. Business Settings
  - [ ] 17.1 Implement business settings server actions
    - Create `src/actions/settings.ts` with updateBusinessSettings, updateGroomerSlug
    - Validate slug format (^[a-z0-9-]{3,40}$) and uniqueness
    - Validate deposit amount (0-500), estimate rules (-50% to +50%)
    - _Requirements: 15.1, 15.4, 15.5, 15.6_

  - [ ] 17.2 Build settings page with business profile form
    - Create `src/app/(portal)/settings/page.tsx`
    - Include: business name, logo upload, phone, email, deposit amount, slug, estimate rules, theme toggle
    - Implement logo upload with UploadThing (PNG/JPG/WebP, max 5MB, min 200x200)
    - Show slug availability check with error for duplicates
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6_

- [ ] 18. File Upload System
  - [ ] 18.1 Configure UploadThing with file routers and upload components
    - Create `src/lib/upload/config.ts` with petPhoto, groomerLogo, bookingPetPhoto endpoints
    - Create `src/app/api/uploadthing/route.ts` API route
    - Create `src/components/ui/ImageUpload.tsx` reusable component with preview, progress bar, error handling
    - Enforce: image only, max 5MB, PNG/JPG/WebP
    - Show thumbnail preview within 2 seconds of file selection
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_

- [ ] 19. Onboarding Wizard
  - [ ] 19.1 Implement onboarding multi-step flow
    - Create `src/app/onboarding/page.tsx` with step progression
    - Steps: business info → services & pricing → logo upload → Google Calendar → availability
    - Persist each step on completion, track current step in GroomerProfile
    - Resume from last incomplete step on revisit
    - Mark profile as active on final step completion, redirect to dashboard
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [ ] 20. Analytics Dashboard
  - [ ] 20.1 Implement analytics data aggregation and page
    - Create `src/app/(portal)/analytics/page.tsx`
    - Calculate current month: total bookings, total revenue (deposits), no-show rate
    - Calculate previous month values for comparison (show numeric difference)
    - Handle zero-data state (display zeros, omit comparison)
    - _Requirements: 16.1, 16.2, 16.3_

  - [ ]* 20.2 Write property test for no-show rate calculation
    - **Property 12: Analytics no-show rate calculation**
    - **Validates: Requirements 16.1**

- [ ] 21. SEO and Public Page Optimization
  - [ ] 21.1 Implement SEO metadata and structured data for public booking page
    - Add generateMetadata to `/book/[groomerSlug]/page.tsx` with title (max 60 chars), description (max 160 chars), OG tags
    - Add JSON-LD structured data (schema.org LocalBusiness) with business name, address, services
    - Handle missing profile data with fallback title "Pet Grooming Services"
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

- [ ] 22. Error Handling and Form Validation Polish
  - [ ] 22.1 Implement global error boundaries and server action error wrapper
    - Create `src/app/(portal)/error.tsx` portal error boundary
    - Create `src/lib/errors.ts` with AppError class and safeAction wrapper
    - Create `src/lib/retry.ts` with withRetry utility (3 attempts, exponential backoff)
    - Ensure all server actions use safeAction for consistent error handling
    - Non-technical user-facing messages, detailed server-side logging
    - _Requirements: 21.1, 21.4, 21.5, 21.6_

  - [ ] 22.2 Ensure all forms implement dual client+server validation
    - Verify all React Hook Form forms use Zod schemas
    - Ensure inline error display adjacent to invalid fields
    - Ensure errors clear within 1 second of field correction
    - Ensure valid field values are never cleared on validation failure
    - _Requirements: 21.1, 21.2, 21.3_

- [ ] 23. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 24. Testing Setup and Integration Tests
  - [ ] 24.1 Configure Vitest and fast-check for unit and property-based testing
    - Create `vitest.config.ts` with path aliases, node environment, setup file
    - Create `tests/setup.ts` with MongoDB memory server setup
    - Install fast-check, mongodb-memory-server, @vitest/coverage-v8
    - _Requirements: 21.1_

  - [ ]* 24.2 Write integration tests for booking flow end-to-end
    - Test complete booking flow: pet info → owner → estimate → slot → payment → appointment creation
    - Test database record creation on successful booking
    - _Requirements: 7.3, 8.1_

  - [ ]* 24.3 Write integration tests for authentication flow
    - Test registration → login → session → lockout
    - Test Google OAuth flow
    - Test middleware route protection
    - _Requirements: 1.1, 1.2, 1.5, 1.7_

- [ ] 25. Final Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation order prioritizes end-to-end functionality: a user can register, book, and be managed before polish features are added
- All code uses TypeScript with strict mode enabled
- All forms use React Hook Form + Zod for dual client/server validation
- External service calls (Stripe, Google Calendar, email) use the withRetry utility

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "24.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "3.2", "3.4", "3.5", "3.6"] },
    { "id": 2, "tasks": ["1.4", "2.1", "3.3"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["5.5", "5.6", "6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 8, "tasks": ["6.5", "6.6", "6.7"] },
    { "id": 9, "tasks": ["6.8", "6.9", "18.1"] },
    { "id": 10, "tasks": ["6.10", "6.11"] },
    { "id": 11, "tasks": ["8.1", "9.1"] },
    { "id": 12, "tasks": ["8.2", "8.3", "9.2"] },
    { "id": 13, "tasks": ["10.1", "11.1"] },
    { "id": 14, "tasks": ["10.2", "10.3", "11.2", "11.3"] },
    { "id": 15, "tasks": ["12.1", "15.1"] },
    { "id": 16, "tasks": ["12.2", "14.1", "15.2"] },
    { "id": 17, "tasks": ["14.2", "14.3", "16.1"] },
    { "id": 18, "tasks": ["14.4", "16.2", "17.1"] },
    { "id": 19, "tasks": ["17.2", "19.1"] },
    { "id": 20, "tasks": ["20.1", "21.1"] },
    { "id": 21, "tasks": ["20.2", "22.1"] },
    { "id": 22, "tasks": ["22.2", "24.2", "24.3"] }
  ]
}
```
