import Image from 'next/image';
import { PawPrint } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { safeHttpsImageSrc } from '@/lib/images';

/**
 * BookingsPaused — shown on the public booking page instead of the booking
 * wizard when the groomer's account has lapsed (trial ended, canceled,
 * expired, or past_due after grace). Existing data stays readable elsewhere;
 * this only stops NEW online bookings and points the client to the groomer's
 * direct contact details.
 *
 * Server-compatible: no client hooks. 44px tap targets on contact links.
 *
 * _Requirements: 2.1_
 */
export interface BookingsPausedProps {
  businessName: string;
  logoUrl?: string | null;
  phone?: string;
  email?: string;
}

export function BookingsPaused({ businessName, logoUrl, phone, email }: BookingsPausedProps) {
  const logoSrc = safeHttpsImageSrc(logoUrl);
  const hasContact = Boolean(phone || email);

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-6 flex flex-col items-center text-center">
        {logoSrc ? (
          <Image
            src={logoSrc}
            alt={`${businessName} logo`}
            width={96}
            height={96}
            className="mx-auto mb-3 h-20 w-20 rounded-full object-cover shadow-card ring-2 ring-base-100"
          />
        ) : (
          <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PawPrint className="h-9 w-9" aria-hidden="true" />
          </div>
        )}
        <h1 className="text-2xl font-bold text-primary">{businessName}</h1>
      </div>

      <Card>
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-base-content">
            Online booking is paused
          </h2>

          <div className="alert alert-info rounded-2xl" role="status">
            <span>
              {businessName} isn&apos;t taking online bookings right now. Please
              contact them directly to book.
            </span>
          </div>

          {hasContact && (
            <ul className="flex flex-col gap-2 text-sm text-base-content">
              {phone && (
                <li>
                  <span className="font-medium">Phone: </span>
                  <a
                    href={`tel:${phone}`}
                    className="link link-primary inline-flex min-h-11 items-center"
                  >
                    {phone}
                  </a>
                </li>
              )}
              {email && (
                <li>
                  <span className="font-medium">Email: </span>
                  <a
                    href={`mailto:${email}`}
                    className="link link-primary inline-flex min-h-11 items-center"
                  >
                    {email}
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

export default BookingsPaused;
