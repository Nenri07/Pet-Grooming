/**
 * Product tour media (landing page "See it in action" section).
 *
 * The section stays HIDDEN while this list is empty, so nothing half-finished
 * is ever shown to visitors. One entry per demo:
 *
 *   // An interactive Supademo. `demoId` is the last part of the share link:
 *   //   https://app.supademo.com/demo/<demoId>
 *   // The demo must be public ("anyone with the link"); a private one shows
 *   // visitors a login page.
 *   { id: 'tour', title: '...', description: '...', kind: 'supademo', demoId: '...' },
 *
 *   // A video or a self-hosted HTML page, from `public/demo/`:
 *   { id: 'v', title: '...', description: '...', kind: 'video', src: '/demo/clip.mp4', poster: '/demo/clip.jpg' },
 *   { id: 'h', title: '...', description: '...', kind: 'html',  src: '/demo/console.html' },
 *
 * With two or more entries the section shows tabs. Keep what the demos show
 * honest: sample data only, and only features that exist.
 */
interface TourItemBase {
  /** Stable key, also used for the tab id. */
  id: string;
  /** Short tab label and the title shown on the demo card. */
  title: string;
  /** One sentence shown above the demo. */
  description: string;
}

export type TourItem =
  | (TourItemBase & {
      /** Interactive Supademo, loaded only after the visitor clicks start. */
      kind: 'supademo';
      /** From https://app.supademo.com/demo/<demoId> */
      demoId: string;
    })
  | (TourItemBase & {
      /** `video` renders a <video>. */
      kind: 'video';
      /** Path under /public, e.g. "/demo/clip.mp4". */
      src: string;
      poster?: string;
    })
  | (TourItemBase & {
      /** `html` renders a sandboxed <iframe> of a page under /public. */
      kind: 'html';
      src: string;
    });

export const productTour: TourItem[] = [
  {
    id: 'tour',
    title: 'Pawxis in 90 seconds',
    description:
      'Follow a booking from the client\u2019s phone, then see how a groomer runs the day.',
    kind: 'supademo',
    // Public share link: https://app.supademo.com/demo/cmwjnuns300lclj1yjs5wty88
    demoId: 'cmwjnuns300lclj1yjs5wty88',
  },
];

export default productTour;
