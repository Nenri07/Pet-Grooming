/**
 * Product tour media (landing page "See it live" section).
 *
 * The section stays HIDDEN while this list is empty, so nothing half-finished
 * is ever shown to visitors. To publish it, drop your files into
 * `public/demo/` and add one entry per file, e.g.:
 *
 *   {
 *     id: 'booking-link',
 *     title: 'Create your live booking link',
 *     description: 'Pick your link, share it, and clients can book in minutes.',
 *     kind: 'video',
 *     src: '/demo/booking-link.mp4',
 *     poster: '/demo/booking-link.jpg', // optional
 *   },
 *   {
 *     id: 'home-console',
 *     title: 'Your home console',
 *     description: 'Today\u2019s route, upcoming bookings and Order Radar in one screen.',
 *     kind: 'html',
 *     src: '/demo/home-console.html',
 *   },
 *
 * `kind: 'html'` files are shown in a sandboxed iframe (scripts allowed, no
 * access to this site's cookies or storage). Keep the claims on screen honest:
 * use sample data, and label it as an example in the copy.
 */
export interface TourItem {
  /** Stable key, also used for the tab id. */
  id: string;
  /** Short tab label and heading. */
  title: string;
  /** One sentence shown under the heading. */
  description: string;
  /** `video` renders a <video>; `html` renders a sandboxed <iframe>. */
  kind: 'video' | 'html';
  /** Path under /public, e.g. "/demo/booking-link.mp4". */
  src: string;
  /** Optional poster image for videos. */
  poster?: string;
}

export const productTour: TourItem[] = [];

export default productTour;
