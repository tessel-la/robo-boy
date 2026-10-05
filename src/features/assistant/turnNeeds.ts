import type { AssistantTurnNeeds } from './prompt';
import type { AssistantContextChip } from './types';

/**
 * Which domain instructions a turn gets, from what the user wrote and tagged. Keyword routing,
 * not an intent classifier: a phrasing a capability advertises must match here, which
 * `capabilities.test.ts` checks.
 */
export const computeNeeds = (text: string, chips: AssistantContextChip[]): AssistantTurnNeeds => {
  const lower = text.toLowerCase();
  return {
    behaviorTree: chips.some(chip => chip.source === 'behaviorTree') || /\bbehavior[ -]?tree\b|\bbt\b/.test(lower),
    pad: chips.some(chip => chip.source === 'pad') || /\bpad\b|\bgamepad\b|\bjoystick\b|\bcontroller\b/.test(lower),
    rosAction: /\bpublish\b|\bcall\b|\bservice\b|\baction\b|\btopic\b|\bsend\b/.test(lower),
    // Anything about what is on screen: the tool's fragment is short, so err on the side of
    // offering it whenever a panel, layout or window is mentioned.
    workspace:
      chips.some(chip => chip.source === 'workspace') ||
      /\blayout\b|\bpanel\b|\bworkspace\b|\bwindow\b|\bview\b|\bopen\b|\bclose\b|\badd\b|\bremove\b|\bshow\b|\bhide\b/.test(lower) ||
      // Time Series requests rarely say "panel": "plot the speed squared", "smooth that signal".
      /\bplot|\bgraph|\bchart|\bsignals?\b|\btime ?series\b|\bcurves?\b|\baxis\b|\bsmooth|\bfilter|\bderivative\b|\bintegra|\bsquared?\b|\bexpression\b|\bscale\b|\boffset\b|\bnormali[sz]e/.test(lower) ||
      // Data Explorer and Record & Replay requests: "watch /scan", "add a health rule", "what's in this bag".
      /\bcamera\b|\bquality\b|\bwatch|\btrack|\bmonitor|\balert|\bsilen|\bstale\b|\bhealth\b|\brules?\b|\bdiagnostic|\blogs?\b|\brosout\b|\bexplorer\b|\bsubscribers?\b|\bpublishers?\b|\bbandwidth\b|\bhz\b|\bfrequenc|\bqos\b|\brosbag|\bbag\b|\bmcap\b|\brecord|\breplay|\bplayback\b|\bseek\b|\brewind\b/.test(lower),
  };
};
