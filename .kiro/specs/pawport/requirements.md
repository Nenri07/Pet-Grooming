# Requirements Document

## Introduction

PawPort is a production-ready, mobile-first SaaS application designed for solo mobile pet groomers. The platform enables groomers to collect online bookings with Stripe deposits, manage clients and their pets with full service history, present a professional brand through shareable Digital Pet Cards, and reduce no-shows and admin time. The application uses Next.js 14+ with App Router, TypeScript, Tailwind CSS with DaisyUI, MongoDB, and integrates with Stripe, Google Calendar, and file upload services.

## Glossary

- **Groomer**: A registered solo mobile pet groomer who operates the PawPort platform to manage their business
- **Client**: A pet owner who books grooming services through a Groomer's public booking page
- **Pet**: A dog or cat belonging to a Client, with associated profile information and service history
- **Booking_Flow**: The multi-step public form that Clients use to schedule grooming appointments and pay deposits
- **Digital_Pet_Card**: A branded, shareable, downloadable card displaying a Pet's profile, service history, and Groomer branding
- **Groomer_Portal**: The authenticated private dashboard where Groomers manage appointments, clients, pets, services, and business settings
- **Appointment**: A scheduled grooming service event linking a Groomer, Client, Pet, service type, date, time, and location
- **Deposit**: A partial payment collected via Stripe during booking to reduce no-shows
- **Service**: A grooming service type defined by the Groomer with name, description, base price, and duration estimate
- **Estimate_Engine**: The logic that calculates a price range for a service based on pet size, coat complexity, and configured rules
- **Availability_Calendar**: The Groomer's schedule synced bidirectionally with Google Calendar to show open time slots
- **Onboarding_Wizard**: A guided multi-step setup flow for new Groomers to configure their business profile, services, and calendar
- **Theme_System**: The centralized color and mode configuration using DaisyUI that provides light and dark modes with a premium aesthetic

---

## Requirements

### Requirement 1: Groomer Registration and Authentication

**User Story:** As a Groomer, I want to register and log in securely, so that I can access my private portal and manage my business.

#### Acceptance Criteria

1. WHEN a Groomer submits valid registration credentials (email and password meeting minimum 8 characters with at least one uppercase letter, one lowercase letter, and one digit), THE Auth_System SHALL create a new Groomer account and redirect to the Onboarding_Wizard
2. WHEN a Groomer submits valid login credentials, THE Auth_System SHALL authenticate the Groomer and redirect to the Groomer_Portal dashboard
3. WHERE Google OAuth is configured, THE Auth_System SHALL present a Google authentication option enabling Groomers to initiate registration and login using their Google account
4. IF a Groomer submits invalid or duplicate credentials during registration, THEN THE Auth_System SHALL display a generic error message such as "Unable to create account. Please check your details and try again." without revealing whether the email already exists
5. WHEN an unauthenticated user attempts to access a Groomer_Portal route, THE Auth_System SHALL redirect the user to the login page
6. THE Auth_System SHALL maintain session persistence using secure HTTP-only cookies with a default expiration period of 7 days
7. IF a Groomer submits incorrect login credentials, THEN THE Auth_System SHALL display a generic error message "Invalid email or password" and, after 5 consecutive failed login attempts within 15 minutes, temporarily lock the account for 30 minutes

---

### Requirement 2: Groomer Onboarding

**User Story:** As a new Groomer, I want a guided setup wizard, so that I can quickly configure my business and start accepting bookings.

#### Acceptance Criteria

1. WHEN a Groomer completes registration, THE Onboarding_Wizard SHALL present a multi-step setup flow in the following order: business information, services and pricing, logo upload, Google Calendar connection, first availability configuration
2. WHEN the Groomer submits a wizard step with all required fields populated and passing validation, THE System SHALL persist the data and allow the Groomer to proceed to the next step
3. WHEN the Groomer completes all Onboarding_Wizard steps, THE System SHALL mark the Groomer profile as active and redirect to the Groomer_Portal dashboard
4. WHILE the Groomer is on any Onboarding_Wizard step, THE System SHALL display a progress indicator showing the current step number out of the total number of steps
5. IF the Groomer navigates away from the Onboarding_Wizard or the session expires while the Onboarding_Wizard is incomplete, THEN THE System SHALL save all data from completed steps and resume from the last incomplete step on next login, and WHERE the Groomer has completed all Onboarding_Wizard steps, THE System SHALL NOT re-trigger save-and-resume on subsequent navigation
6. IF the Groomer submits a wizard step with missing required fields or invalid data, THEN THE System SHALL display an error message indicating which fields require correction and remain on the current step without losing entered data
7. IF the Google Calendar connection fails during the onboarding step, THEN THE System SHALL display an error message indicating the connection failure and allow the Groomer to retry or skip the Google Calendar step
8. WHEN the Groomer uploads a logo, THE System SHALL accept image files in PNG, JPG, or SVG format with a maximum file size of 5 MB and reject files that do not meet these constraints with an error message indicating the accepted formats and size limit

---

### Requirement 3: Public Booking Flow — Pet Information

**User Story:** As a Client, I want to provide my pet's details during booking, so that the Groomer can prepare for the appointment.

#### Acceptance Criteria

1. WHEN a Client accesses the public booking URL (/book/[groomerSlug]), THE Booking_Flow SHALL display step 1: Pet Information form
2. THE Booking_Flow SHALL collect the following pet details: name (required, maximum 50 characters), photo (optional, PNG/JPG/WebP up to 5MB), breed (required, selectable from a predefined list), weight in pounds or kilograms (required, numeric between 1 and 200), age in years (required, numeric between 0 and 30), temperament (required, selectable from predefined options such as calm, nervous, aggressive, friendly), coat condition (required, selectable from: smooth, double, wire, curly, long, matted), special flags (optional, multi-select from predefined options), and notes (optional, maximum 500 characters)
3. WHEN the Client submits valid pet information, THE Booking_Flow SHALL transition to step 2 with an animated transition completing within 400 milliseconds, and IF the animated transition takes longer than 400 milliseconds on a slow device, THEN THE Booking_Flow SHALL block progression to step 2 until the animation completes
4. IF the Client submits incomplete or invalid pet information, THEN THE Booking_Flow SHALL display inline validation errors adjacent to each invalid field without clearing valid field values
5. WHILE the Booking_Flow is active, THE System SHALL display a progress indicator showing the current step out of total steps (5 steps total), and WHILE a transition or loading state between steps is in progress, THE System MAY temporarily hide the progress indicator
6. IF the Client navigates back to step 1 from a later step, THEN THE Booking_Flow SHALL retain all previously entered pet information

---

### Requirement 4: Public Booking Flow — Owner Details and Service Address

**User Story:** As a Client, I want to provide my contact details and service address, so that the Groomer knows where to come.

#### Acceptance Criteria

1. WHEN the Client completes step 1, THE Booking_Flow SHALL display step 2: Owner details and service address form
2. THE Booking_Flow SHALL collect: Client full name (required, maximum 100 characters), email (required, maximum 254 characters), phone number (required, minimum 7 and maximum 15 digits with optional leading +), street address (required, maximum 200 characters), city (required, maximum 100 characters), state/province (required, maximum 100 characters), and postal code (required, maximum 20 characters)
3. WHEN the Client submits valid owner details, THE Booking_Flow SHALL transition to step 3 with an animated transition completing within 400 milliseconds
4. IF the Client submits an invalid email format, a phone number outside the accepted length range, or any required field left empty, THEN THE Booking_Flow SHALL display a validation error message adjacent to each invalid field indicating the specific validation failure
5. IF the Client navigates back from step 2, THEN THE Booking_Flow SHALL retain all previously entered owner details and service address field values
6. IF the transition mechanism fails when advancing from step 2 to step 3, THEN THE Booking_Flow SHALL display an error message indicating the transition failure and provide a retry mechanism rather than silently remaining on step 2

---

### Requirement 5: Public Booking Flow — Instant Estimate

**User Story:** As a Client, I want to see an estimated price range before booking, so that I can decide whether to proceed.

#### Acceptance Criteria

1. WHEN the Client completes step 2, THE Booking_Flow SHALL display step 3: an instant price estimate range within 3 seconds
2. WHEN step 3 is displayed, THE Estimate_Engine SHALL calculate the estimate range based on the Pet's weight, coat condition (one of: smooth, double, wire, curly, long, or matted), and the Groomer's configured estimate rules
3. THE Booking_Flow SHALL display the estimate as a minimum and maximum price in the local currency with exactly two decimal places (e.g., "$50.00 – $75.00")
4. IF the Estimate_Engine cannot calculate an estimate due to missing pet data or absent groomer estimate rules, THEN THE Booking_Flow SHALL display an error message indicating the reason and prevent the Client from advancing to step 4
5. WHEN the Client confirms the estimate, THE Booking_Flow SHALL transition to step 4 with an animated transition completing within 400 milliseconds, and IF step 3 was never displayed or an estimate error is present, THEN THE Booking_Flow SHALL block confirmation and prevent advancing to step 4

---

### Requirement 6: Public Booking Flow — Calendar Availability

**User Story:** As a Client, I want to see available time slots from the Groomer's real calendar, so that I can pick a convenient time.

#### Acceptance Criteria

1. WHEN the Client reaches step 4, THE Booking_Flow SHALL display available time slots from the Groomer's Availability_Calendar for the next 14 calendar days, derived from the Groomer's configured availability windows and the estimated service duration
2. THE Availability_Calendar SHALL reflect availability synced from the Groomer's connected Google Calendar within 5 minutes of external changes
3. WHEN the Client selects an available time slot, THE Booking_Flow SHALL mark it as tentatively reserved for 10 minutes and transition to step 5
4. IF a Client attempts to select a time slot that has been booked by another Client since page load, THEN THE Booking_Flow SHALL display only the conflict error message indicating the slot is no longer available and refresh the available time slots, without simultaneously displaying the contact-groomer message
5. IF no available time slots exist within the displayed 14-day period, THEN THE Booking_Flow SHALL display a message indicating no availability and suggest the Client contact the Groomer directly

---

### Requirement 7: Public Booking Flow — Stripe Deposit Payment

**User Story:** As a Client, I want to pay a deposit online, so that I can secure my booking.

#### Acceptance Criteria

1. WHEN the Client selects a time slot in step 4, THE Booking_Flow SHALL display step 5: Stripe payment form for the deposit amount configured by the Groomer
2. THE Payment_System SHALL process deposits using Stripe Checkout or Payment Element
3. WHEN the payment succeeds, THE System SHALL create an Appointment record, create or update the Client record, create or update the Pet record, and transition to the success page
4. IF the payment fails, THEN THE Payment_System SHALL display the Stripe error message and allow the Client to retry up to 3 times, and WHEN the Client exhausts all 3 retry attempts, THE Payment_System SHALL display both the Stripe error message and the contact-groomer message together
5. THE Payment_System SHALL record a Transaction entry containing the Stripe payment ID, amount, appointment reference, and timestamp
6. IF the Stripe service is unavailable or the payment request times out after 30 seconds, THEN THE Payment_System SHALL display an error message indicating temporary unavailability and allow the Client to retry
7. IF the tentative time slot reservation expires (10 minutes) during the payment process, THEN THE System SHALL cancel the payment attempt and redirect the Client back to step 4 to select a new time slot

---

### Requirement 8: Public Booking Flow — Confirmation and Notifications

**User Story:** As a Client and Groomer, I want confirmation of a successful booking, so that both parties have a record of the appointment.

#### Acceptance Criteria

1. WHEN a booking is completed successfully, THE System SHALL display a success page containing the appointment date, time, selected services, service address, and deposit amount, and IF any email or Google Calendar notification fails, THEN THE System SHALL display a warning on the success page indicating that some notifications may be pending
2. WHEN a booking is completed successfully, THE System SHALL send a confirmation email to the Client within 5 minutes containing the appointment date, time, selected services, service address, groomer name, and deposit amount paid, and IF the confirmation email fails, THEN THE System SHALL keep the booking complete and allow the success page and other notifications to proceed independently
3. WHEN a booking is completed successfully, THE System SHALL send a notification email to the Groomer within 5 minutes containing the appointment date, time, selected services, service address, client name, client phone number, pet name, pet breed, pet size, and any special handling notes
4. WHEN a booking is completed successfully, THE System SHALL create an event on the Groomer's connected Google Calendar containing the appointment date, time, duration, service address, client name, and selected services
5. IF the confirmation email to the Client fails to send, THEN THE System SHALL retry sending the email up to 3 times and log the failure for administrative review
6. IF the Google Calendar event creation fails, THEN THE System SHALL log the failure for administrative review and still display the success page to the Client

---

### Requirement 9: Groomer Dashboard

**User Story:** As a Groomer, I want a dashboard showing my upcoming appointments at a glance, so that I can plan my day.

#### Acceptance Criteria

1. WHEN a Groomer accesses the Groomer_Portal, THE Dashboard SHALL display today's appointments and appointments scheduled within the next 7 calendar days, sorted in ascending order by date and time
2. THE Dashboard SHALL display for each appointment: pet name, client name, service address, scheduled time, key notes (truncated to 100 characters with an option to view full text), appointment status, and a link to Google Maps directions, and WHERE no appointments are displayed, THE Dashboard SHALL hide the appointment detail fields completely
3. WHEN a Groomer clicks on an appointment, THE Dashboard SHALL navigate to the full appointment detail view
4. THE Dashboard SHALL display appointment status indicators using visually distinct labels for each state: upcoming, in-progress, completed, and cancelled
5. IF no appointments exist for the displayed time period, THEN THE Dashboard SHALL display a message indicating that no upcoming appointments are scheduled
6. IF a service address is not available for an appointment, THEN THE Dashboard SHALL omit the Google Maps directions link and display a message indicating the address is unavailable

---

### Requirement 10: Client Management

**User Story:** As a Groomer, I want to view and search my client list, so that I can quickly find client information.

#### Acceptance Criteria

1. WHEN a Groomer navigates to the Clients section, THE Groomer_Portal SHALL display a paginated list of all Clients associated with the Groomer, showing no more than 50 Clients per page
2. WHEN a Groomer enters a search query of at least 1 character, THE Groomer_Portal SHALL filter the Client list by partial match against name, email, or phone number within 300 milliseconds of the last keystroke
3. IF no Clients match the search query, THEN THE Groomer_Portal SHALL display a message indicating that no results were found
4. WHEN a Groomer selects a Client, THE Groomer_Portal SHALL display the Client detail view including name, email, phone number, address, and all associated Pets
5. THE Client detail view SHALL allow navigation to each Pet's full profile

---

### Requirement 11: Pet Profile Management

**User Story:** As a Groomer, I want a complete pet profile with service history, so that I can track each pet's grooming needs over time.

#### Acceptance Criteria

1. WHEN a Groomer views a Pet profile, THE Groomer_Portal SHALL display: photo, name, breed, weight, age, temperament, coat condition, special flags, and notes
2. WHEN a Groomer views a Pet profile, THE Groomer_Portal SHALL display a service history timeline showing all past Appointments for that Pet in reverse chronological order, with each entry displaying: date, service type, Groomer notes, and appointment status
3. WHEN a Groomer clicks "Generate Digital Pet Card" on a Pet profile, THE System SHALL generate a Digital_Pet_Card for that Pet and, WHEN generation succeeds, present the Digital_Pet_Card for download, targeting completion within 5 seconds while presenting the card for download only upon successful generation even if generation exceeds 5 seconds
4. IF Digital_Pet_Card generation fails, THEN THE System SHALL display an error message indicating the reason for failure and preserve the Pet profile view without data loss
5. WHEN a Groomer edits Pet profile fields (name, breed, weight, age, temperament, coat condition, special flags, or notes) and submits the changes, THE Groomer_Portal SHALL validate the required fields, and WHERE all required fields are valid, THE Groomer_Portal SHALL persist the updates and display a confirmation message within 3 seconds, and IF any required field is invalid, THEN THE Groomer_Portal SHALL block persistence and SHALL NOT display a confirmation message
6. IF a Groomer submits invalid or incomplete edits to a Pet profile, THEN THE Groomer_Portal SHALL display inline validation errors adjacent to each invalid field and preserve the entered data

---

### Requirement 12: Appointment Management

**User Story:** As a Groomer, I want to manage appointments by updating their status and adding notes, so that I can track my work.

#### Acceptance Criteria

1. THE Groomer_Portal SHALL allow the Groomer to update appointment status to one of: upcoming, in-progress, completed, or cancelled, where valid transitions are: upcoming → in-progress, upcoming → cancelled, in-progress → completed, and in-progress → cancelled
2. WHEN a Groomer marks an Appointment as completed, THE Groomer_Portal SHALL prompt for optional post-groom notes with a maximum length of 2000 characters and persist them to the Appointment record, and IF the post-groom notes prompt mechanism fails, THEN THE Groomer_Portal SHALL allow the status change to complete
3. WHEN an Appointment status changes, THE System SHALL complete a successful sync of the change to the Groomer's connected Google Calendar event within 30 seconds
4. THE Groomer_Portal SHALL display all Appointments in a list view sorted by date in ascending order, with filtering by status and date range
5. IF a Google Calendar sync fails after an Appointment status change, THEN THE System SHALL retain the updated status locally, display an error message indicating the sync failure to the Groomer, and retry the sync up to 3 times

---

### Requirement 13: Services and Pricing Management

**User Story:** As a Groomer, I want to define and manage my service offerings and prices, so that Clients see accurate options during booking.

#### Acceptance Criteria

1. THE Groomer_Portal SHALL allow the Groomer to create, edit, and delete Service entries
2. THE Groomer_Portal SHALL require each Service to have: name (maximum 100 characters), description (maximum 500 characters), base price (numeric, between 0.01 and 9999.99), and estimated duration in minutes (between 15 and 480)
3. WHEN a Groomer updates service pricing, THE System SHALL reflect the updated pricing in the public Booking_Flow within 5 seconds
4. IF a Groomer attempts to delete a Service that has upcoming Appointments associated with it, THEN THE Groomer_Portal SHALL prevent the deletion and display an error message listing the number of upcoming appointments referencing that Service, and WHERE a Service is associated only with past Appointments and no upcoming Appointments, THE Groomer_Portal SHALL allow the deletion
5. THE Groomer_Portal SHALL allow the Groomer to mark a Service as inactive (hidden from the public Booking_Flow) without deleting it

---

### Requirement 14: Availability and Calendar Settings

**User Story:** As a Groomer, I want to configure my availability and sync with Google Calendar, so that Clients only see times I'm free.

#### Acceptance Criteria

1. THE Groomer_Portal SHALL allow the Groomer to configure recurring weekly availability windows specifying: start time (in 15-minute increments from 00:00 to 23:45), end time (in 15-minute increments, must be after start time), and days of week (one or more from Monday through Sunday)
2. WHEN a Groomer connects their Google Calendar, THE Availability_Calendar SHALL perform bidirectional sync: existing Google Calendar events block time slots, and PawPort bookings create Google Calendar events
3. WHEN a new event is added to the Groomer's Google Calendar externally, THE Availability_Calendar SHALL mark that time slot as unavailable within 5 minutes
4. THE Groomer_Portal SHALL allow the Groomer to block specific dates or time ranges manually by selecting a start date/time and end date/time
5. IF the Google Calendar sync encounters a connection failure, THEN THE System SHALL display an error notification to the Groomer and retry the sync up to 3 times at 1-minute intervals
6. IF a Groomer attempts to configure an availability window where the end time is before or equal to the start time, THEN THE System SHALL display a validation error and prevent saving

---

### Requirement 15: Business Settings

**User Story:** As a Groomer, I want to configure my business profile and booking preferences, so that my brand appears professional.

#### Acceptance Criteria

1. THE Groomer_Portal SHALL allow the Groomer to configure: business name (maximum 100 characters), logo, contact information (business phone number and business email address), deposit amount (a monetary value between 0.00 and 500.00), and estimate rules (price adjustment percentage between -50% and +50% and a note of up to 500 characters per rule)
2. WHEN a Groomer uploads a logo, THE System SHALL accept image files (PNG, JPG, WebP) with a maximum size of 5MB and minimum dimensions of 200x200 pixels, and store them using the configured file upload service
3. IF a Groomer uploads a logo that exceeds 5MB or is not a supported format, THEN THE System SHALL reject the upload and display an error message indicating the file size limit or supported formats
4. WHEN a Groomer updates business settings, THE System SHALL persist the update and reflect changes on the public Booking_Flow page, targeting propagation within 5 seconds, and IF propagation to the public Booking_Flow page takes longer than 5 seconds, THEN THE System SHALL allow the business setting update to complete without failing the update
5. THE Groomer_Portal SHALL allow the Groomer to set a unique groomer slug for the public booking URL (/book/[groomerSlug]) containing only lowercase letters, numbers, and hyphens, with a length between 3 and 40 characters
6. IF a Groomer enters a slug that is already in use by another Groomer, THEN THE System SHALL display an error message indicating the slug is unavailable and prevent the setting from being saved

---

### Requirement 16: Analytics Dashboard

**User Story:** As a Groomer, I want basic business analytics, so that I can track my performance.

#### Acceptance Criteria

1. THE Groomer_Portal SHALL display the following analytics for the current month: total bookings count (integer), total revenue from deposit Transactions (currency with 2 decimal places), and no-show rate as a percentage (1 decimal place) where no-show is defined as an Appointment whose scheduled date has passed and whose status is neither completed nor cancelled
2. WHEN a Groomer views analytics, THE System SHALL calculate metrics from Appointment and Transaction records within the current month, display the current month totals, and display the previous month's values alongside for comparison, showing the numeric difference for the total bookings count and total revenue metrics only
3. IF no Appointment or Transaction records exist for the displayed month, THEN THE System SHALL display zero values for all metrics and omit the comparison indicators

---

### Requirement 17: Digital Pet Card Generation

**User Story:** As a Groomer, I want to generate a beautiful branded pet card for each pet, so that I can share it with Clients as a professional touch.

#### Acceptance Criteria

1. WHERE the Pet has at least one service history entry, WHEN a Groomer triggers Digital_Pet_Card generation for a Pet, THE System SHALL render a card containing: pet photo (or a placeholder silhouette if no photo exists), pet name, breed, weight, age, temperament, coat notes, special flags, the most recent 3 to 5 service entries (or all entries if fewer than 3 exist), next recommended grooming date (calculated as last service date plus the Groomer's configured service interval), Groomer logo, business name, and contact information, with zero-service-entry handling delegated to acceptance criterion 6
2. THE Digital_Pet_Card SHALL use the Groomer's branding (logo, business name) and display using the application's DaisyUI theme colors with rounded-2xl card styling and soft shadow
3. THE Digital_Pet_Card SHALL provide a "Copy Shareable Link" action that copies a public URL to the clipboard and displays a toast confirmation
4. THE Digital_Pet_Card SHALL provide a "Download as PDF" action that generates and downloads a PDF version of the card within 10 seconds
5. WHEN a Client or third party accesses a Digital_Pet_Card shareable link, THE System SHALL render the card as a public page without requiring authentication, responsive to viewports from 320px wide
6. IF the Pet has no service history entries, THEN THE Digital_Pet_Card SHALL omit the service history section and display a message such as "No services recorded yet"

---

### Requirement 18: Theme System and Visual Design

**User Story:** As a Groomer, I want the application to look premium and support light and dark modes, so that the platform reflects my professional brand.

#### Acceptance Criteria

1. THE Theme_System SHALL use DaisyUI as the single source of truth for colors and component styling across the application
2. THE Theme_System SHALL provide light and dark modes with a toggle accessible from the Groomer_Portal that applies the selected theme immediately without a page reload
3. WHEN a Groomer selects a theme mode, THE Theme_System SHALL persist the selection so that the chosen mode is restored on subsequent visits
4. IF no theme preference has been previously stored, THEN THE Theme_System SHALL default to light mode
5. THE Theme_System SHALL define its color palette using soft blues, warm neutrals, and gentle pink accents configured as a custom DaisyUI theme, with cards styled at rounded-2xl and drop shadows no darker than 10% opacity
6. THE System SHALL use Inter or Geist as the primary typeface with a minimum body text size of 16px and a minimum line height of 1.5
7. THE System SHALL apply Framer Motion transitions with a duration between 200ms and 400ms for page navigation and multi-step form transitions throughout the application
8. IF Framer Motion fails to load or execute, THEN THE System SHALL allow page navigation and multi-step form transitions to proceed without animated transitions

---

### Requirement 19: Responsive and Mobile-First Design

**User Story:** As a Client or Groomer, I want the application to work seamlessly on mobile devices, so that I can use it on the go.

#### Acceptance Criteria

1. THE System SHALL implement mobile-first responsive design with breakpoints at 767px (mobile), 768–1023px (tablet), and 1024px and above (desktop), ensuring all views render without horizontal scrolling within each breakpoint range
2. WHILE the viewport width is 767px or below, THE System SHALL render all interactive elements with a minimum touch target size of 44x44 pixels
3. WHILE data is being fetched for a view, THE System SHALL display a loading skeleton placeholder within 200 milliseconds of the fetch initiation until the data is loaded or an error occurs
4. IF a list or view contains no data, THEN THE System SHALL display an empty state that includes a label identifying the empty collection and a message suggesting a next action the user can take
5. WHEN an action results in success, error, or informational feedback, THE System SHALL display a toast notification that auto-dismisses after 5 seconds for success and informational types, and persists until the user manually dismisses it for error types
6. IF multiple toast notifications are triggered in sequence, THEN THE System SHALL stack up to 3 visible toasts simultaneously and queue any additional notifications until a visible toast is dismissed or expires

---

### Requirement 20: SEO and Public Page Optimization

**User Story:** As a Groomer, I want my public booking page to be SEO-optimized, so that potential Clients can find me through search engines.

#### Acceptance Criteria

1. THE System SHALL render the public booking page (/book/[groomerSlug]) with server-side rendering and include the following meta tags: title, meta description, og:title, og:description, og:type, and og:url
2. THE System SHALL include structured data (JSON-LD) conforming to the schema.org LocalBusiness type on the public booking page, including at minimum the business name, address, and list of offered services
3. THE System SHALL generate a page title containing the Groomer's business name and primary service category, with a maximum length of 60 characters, and a meta description containing the business name, location, and up to 3 services offered, with a maximum length of 160 characters
4. IF the Groomer's profile is both missing the business name and has no services configured, THEN THE System SHALL render the page with a generic fallback title of "Pet Grooming Services" and a fallback meta description indicating the page belongs to a pet grooming provider, and WHERE services are configured but the business name is missing, THE System SHALL generate custom title and meta description content using the configured service information

---

### Requirement 21: Error Handling and Form Validation

**User Story:** As a Client or Groomer, I want clear error messages and validation feedback, so that I can correct mistakes easily.

#### Acceptance Criteria

1. THE System SHALL validate all form inputs on both client-side (using React Hook Form with Zod schemas) and server-side before processing, and IF client-side validation passes but server-side validation fails, THEN THE System SHALL handle the failure as a form validation error and display inline error messages adjacent to each invalid field
2. WHEN a form submission fails validation, THE System SHALL display inline error messages adjacent to each invalid field without clearing valid field values
3. WHEN the user corrects a previously invalid field, THE System SHALL remove or update the inline error message for that field within 1 second
4. IF an unexpected server error occurs, THEN THE System SHALL display a non-technical error message indicating the operation could not be completed and log the error details server-side
5. IF a network failure occurs during a request, THEN THE System SHALL display an error message indicating loss of connectivity and present a retry option for the failed request
6. WHILE the retry option has failed fewer than 3 consecutive times, THE System SHALL keep the retry option enabled even while displaying the message instructing the user to check their connection, and IF the user retries a failed request and it fails 3 consecutive times, THEN THE System SHALL disable the retry option and display a message instructing the user to check their connection or try again later

---

### Requirement 22: Database Schema and Data Integrity

**User Story:** As a developer, I want a well-structured database schema, so that data relationships are maintained and queries are performant.

#### Acceptance Criteria

1. THE Database SHALL define the following models: User (Groomer), GroomerProfile (Business), Client, Pet, Service, Appointment, and Transaction
2. THE Database SHALL enforce referential relationships: a Client belongs to a Groomer, a Pet belongs to a Client, an Appointment references a Groomer, Client, Pet, and Service, and a Transaction references an Appointment
3. IF a parent record is deleted, THEN THE Database SHALL prevent the deletion and return an error when child records still reference it, except that deleting a Client SHALL cascade-delete that Client's Pets
4. THE Database SHALL include createdAt and updatedAt timestamps on all models, automatically set createdAt on record creation and automatically update updatedAt on every record modification
5. THE Database SHALL define indexes on the following fields: groomerSlug, appointment date, client email, and all foreign key references
6. THE Database SHALL enforce unique constraints on groomerSlug globally and on client email within the scope of a single Groomer
7. IF a record is created or updated with a foreign key referencing a non-existent parent record, THEN THE Database SHALL reject the operation and return a referential integrity error, except that WHERE a designated bulk operation such as an import or migration is in progress, THE Database SHALL allow foreign key validation to be bypassed for that operation

---

### Requirement 23: File Upload for Pet Photos and Logos

**User Story:** As a Groomer or Client, I want to upload images, so that pet profiles and business branding include visual elements.

#### Acceptance Criteria

1. WHEN a user uploads a pet photo or business logo, THE System SHALL accept image files in PNG, JPG, or WebP format with a maximum file size of 5MB and minimum dimensions of 100x100 pixels
2. THE System SHALL store uploaded files using UploadThing or Cloudinary and persist the returned URL in the corresponding database record, and WHEN a file has been stored successfully, THE System SHALL update the upload status to reflect the completed state rather than leaving the status pending
3. IF a file upload fails due to network error, unsupported format, or exceeding the size limit, THEN THE System SHALL display a specific error message indicating the failure reason and allow the user to retry without losing other form data
4. WHEN a file is selected for upload, THE System SHALL display a thumbnail preview of the image within 2 seconds before final form submission
5. WHILE a file upload is in progress, THE System SHALL display an upload progress indicator showing percentage complete
