import type { Metadata } from 'next';
import { connectDB } from '@/lib/db/connect';
import { getRebook } from '@/lib/redis';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { Service } from '@/lib/db/models/service';
import { Pet } from '@/lib/db/models/pet';
import { Client } from '@/lib/db/models/client';
import {
  BookingFlow,
  type BookingGroomer,
  type BookingInitialState,
} from '@/components/booking/BookingFlow';
import type { PetInfoInput, OwnerDetailsInput } from '@/types';

/**
 * Public rebook page — /rebook/[token] (Master Spec §11.4).
 *
 * A rebooking-autopilot nudge SMS carries `/rebook/{token}`. This resolves the
 * token to the pet + owner, prefills the {@link BookingFlow} with their details,
 * and jumps to the estimate step so the returning client only reviews the
 * estimate and picks a slot ("skip to step 3/4"). Falls back to a fresh flow
 * (or a not-found notice) when the token is expired.
 *
 * Rebook pages are noindex — private, single-use links.
 *
 * _Master Spec: §11.4_
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Book your next groom',
  robots: { index: false, follow: false },
};

interface ResolvedRebook {
  groomer: BookingGroomer;
  initialState: BookingInitialState;
  petName: string;
}

async function resolveRebook(token: string): Promise<ResolvedRebook | null> {
  const record = await getRebook(token).catch(() => null);
  if (!record) return null;

  await connectDB();

  const [profile, pet, client] = await Promise.all([
    GroomerProfile.findOne({ userId: record.gid }).lean(),
    Pet.findOne({ _id: record.petId }).lean(),
    Client.findOne({ _id: record.clientId, groomerId: record.gid }).lean(),
  ]);
  if (!profile || !pet || !client) return null;

  const services = await Service.find({ groomerId: record.gid, isActive: true })
    .select('name basePrice durationMinutes')
    .lean();

  const groomer: BookingGroomer = {
    slug: profile.groomerSlug ?? '',
    businessName: profile.businessName ?? 'Pet Grooming',
    services: services.map((s) => ({
      name: s.name,
      basePrice: s.basePrice,
      durationMinutes: s.durationMinutes,
    })),
  };

  const p = pet as unknown as {
    name: string;
    photoUrl?: string;
    breed: string;
    weight: number;
    weightUnit: PetInfoInput['weightUnit'];
    age: number;
    temperament: PetInfoInput['temperament'];
    coatCondition: PetInfoInput['coatCondition'];
    specialFlags?: string[];
    notes?: string;
  };
  const c = client as unknown as {
    name: string;
    email: string;
    phone: string;
    address: OwnerDetailsInput['address'];
  };

  const petInfo: PetInfoInput = {
    name: p.name,
    photoUrl: p.photoUrl,
    breed: p.breed,
    weight: p.weight,
    weightUnit: p.weightUnit,
    age: p.age,
    temperament: p.temperament,
    coatCondition: p.coatCondition,
    specialFlags: p.specialFlags,
    notes: p.notes,
  };
  const ownerDetails: OwnerDetailsInput = {
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
  };

  // Prefill pet + owner, jump to the estimate step (index 2 → "step 3/4").
  // Built as a literal (not spread from the hook's initialBookingState) so this
  // server component never imports the client-only useBookingFlow module.
  const initialState: BookingInitialState = {
    currentStep: 'estimate',
    stepIndex: 2,
    petInfo,
    ownerDetails,
    smsConsent: false,
    estimate: null,
    selectedSlot: null,
    paymentResult: null,
  };

  return { groomer, initialState, petName: p.name };
}

export default async function RebookPage({ params }: { params: { token: string } }) {
  const resolved = await resolveRebook(params.token);

  return (
    <main className="min-h-screen bg-base-200 px-4 py-8 sm:py-12">
      {resolved ? (
        <>
          <div className="mx-auto mb-6 w-full max-w-xl text-center">
            <h1 className="font-display text-2xl font-bold text-primary">
              {resolved.groomer.businessName}
            </h1>
            <p className="text-sm text-base-content/60">Book your next appointment</p>
          </div>
          <BookingFlow
            groomer={resolved.groomer}
            initialState={resolved.initialState}
            prefillNotice={`Welcome back! We've prefilled ${resolved.petName}'s details — just pick a time.`}
          />
        </>
      ) : (
        <div className="mx-auto w-full max-w-md rounded-box border border-base-content/10 bg-base-100 p-8 text-center shadow-card">
          <h1 className="text-2xl font-bold text-base-content">Link expired</h1>
          <p className="mt-3 text-base-content/70">
            This rebooking link is no longer valid. Please contact your groomer to
            book your next appointment.
          </p>
        </div>
      )}
    </main>
  );
}
