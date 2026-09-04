/**
 * Execution's DOM-free logic — §8.3.8, #144, #145, #146.
 *
 * The playback clock and the announcement strategy, both pure. Everything that needs a
 * canvas, a live region or an animation frame is in `apps/web/src/execution/`, for the
 * same reason the planner's regions are: this package sits in the root TypeScript
 * project, which has no DOM library, and that is what keeps "the clock is testable
 * without a browser" a property of the build rather than a claim.
 */
export type {
  PlaybackSpec,
  PlaybackSpeed,
  PlaybackState,
  PlaybackStatus,
  PlaybackStep,
  TimedEvent,
} from './playback.js';
export {
  DEFAULT_PLAYBACK_SPEED,
  PLAYBACK_SPEEDS,
  advance,
  createPlayback,
  elapsedSeconds,
  pause,
  progressOf,
  resume,
  setSpeed,
  skipToEnd,
  togglePause,
} from './playback.js';

export type { AnnounceableEvent, Announcement, AnnouncementPolicy } from './announce.js';
export {
  DEFAULT_ANNOUNCEMENT_POLICY,
  NOTABLE_KINDS,
  announcementsFor,
  isNotable,
} from './announce.js';
