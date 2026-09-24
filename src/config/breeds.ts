/**
 * Predefined breed list for the public booking flow (Requirement 3.2).
 *
 * The pet breed field is "required, selectable from a predefined list". This
 * module is the single source of truth for that list. It combines common dog
 * and cat breeds and always ends with a catch-all `'Other'` so a Client whose
 * pet's breed is not listed can still complete booking.
 *
 * The Zod `petInfoSchema` validates a submitted breed against `BREED_VALUES`,
 * and the StepPetInfo `<select>` renders `BREED_OPTIONS`.
 *
 * _Requirements: 3.2_
 */

/** Catch-all breed option, always offered last. */
export const OTHER_BREED = 'Other' as const;

/** Common dog breeds offered during booking. */
export const DOG_BREEDS = [
  'Labrador Retriever',
  'Golden Retriever',
  'German Shepherd',
  'French Bulldog',
  'Bulldog',
  'Poodle',
  'Beagle',
  'Rottweiler',
  'Dachshund',
  'Yorkshire Terrier',
  'Boxer',
  'Australian Shepherd',
  'Cavalier King Charles Spaniel',
  'Shih Tzu',
  'Border Collie',
  'Cocker Spaniel',
  'Pomeranian',
  'Maltese',
  'Havanese',
  'Bichon Frise',
  'Shetland Sheepdog',
  'Schnauzer',
  'West Highland White Terrier',
  'Cairn Terrier',
  'Goldendoodle',
  'Labradoodle',
  'Cockapoo',
  'Mixed Breed (Dog)',
] as const;

/** Common cat breeds offered during booking. */
export const CAT_BREEDS = [
  'Domestic Shorthair',
  'Domestic Longhair',
  'Maine Coon',
  'Persian',
  'Ragdoll',
  'Siamese',
  'British Shorthair',
  'Sphynx',
  'Bengal',
  'Norwegian Forest Cat',
  'Himalayan',
  'Mixed Breed (Cat)',
] as const;

/**
 * The full ordered breed list: dogs, then cats, then the `'Other'` catch-all.
 * Used both to build the `<select>` options and to validate submitted values.
 */
export const BREED_VALUES = [
  ...DOG_BREEDS,
  ...CAT_BREEDS,
  OTHER_BREED,
] as const;

/** A breed value known to the booking flow. */
export type Breed = (typeof BREED_VALUES)[number];

/** A single option rendered in the breed `<select>`, with an optional group. */
export interface BreedOption {
  value: Breed;
  label: Breed;
  group: 'Dogs' | 'Cats' | 'Other';
}

/** Options for the breed `<select>`, tagged with an optgroup label. */
export const BREED_OPTIONS: readonly BreedOption[] = [
  ...DOG_BREEDS.map((b) => ({ value: b, label: b, group: 'Dogs' as const })),
  ...CAT_BREEDS.map((b) => ({ value: b, label: b, group: 'Cats' as const })),
  { value: OTHER_BREED, label: OTHER_BREED, group: 'Other' as const },
];

/** Returns true if `value` is a recognized breed from the predefined list. */
export function isValidBreed(value: string): value is Breed {
  return (BREED_VALUES as readonly string[]).includes(value);
}
