import type { ChannelStyleProfile } from "../schemas/channelStyleProfile.js";
import type {
  TransitionType,
  TransitionEvent,
} from "../schemas/videoAnalysis.js";
import type { TransitionSpec } from "../schemas/timeline.js";
import { findByFilename, pickByKeywords, type AssetPack } from "../assets/packLoader.js";

const DEFAULT_DURATION: Record<TransitionType, number> = {
  hard_cut: 0,
  flash: 0.18,
  fade_to_black: 0.5,
  fade_from_black: 0.5,
  fade_to_white: 0.5,
  fade_from_white: 0.5,
  zoom_blur: 0.35,
  motion_blur: 0.35,
  wipe: 0.35,
  glitch: 0.25,
  light_leak: 0.45,
  dissolve: 0.4,
  overlay: 0.3,
  unknown: 0.2,
};

const TYPE_KEYWORDS: Record<TransitionType, string[]> = {
  hard_cut: ["cut"],
  flash: ["flash", "whip"],
  fade_to_black: ["fade", "black"],
  fade_from_black: ["fade", "black"],
  fade_to_white: ["fade", "white"],
  fade_from_white: ["fade", "white"],
  zoom_blur: ["zoom", "blur"],
  motion_blur: ["motion", "blur"],
  wipe: ["wipe"],
  glitch: ["glitch", "vhs"],
  light_leak: ["light", "leak"],
  dissolve: ["dissolve", "cross"],
  overlay: ["overlay"],
  unknown: [],
};

export function resolveTransition(
  type: TransitionType,
  context: string,
  profile: ChannelStyleProfile,
  pack: AssetPack,
): TransitionSpec {
  // Style-library by_context override: prefer the channel's first listed type
  // for this emotional purpose if the planner left it as "unknown".
  let resolved: TransitionType = type;
  let sourceRule: string | null = null;
  if (resolved === "unknown" || resolved === "hard_cut") {
    const ctxList = profile.transition_rules.by_context?.[context];
    if (ctxList && ctxList.length > 0) {
      const candidate = ctxList[0];
      if (candidate && isTransitionType(candidate)) {
        resolved = candidate;
        sourceRule = `transition_rules.by_context.${context}[0]`;
      }
    }
  }

  // Asset file resolution — first try a literal filename match against the
  // channel's transition pack hints (these would come from detected_assets
  // matched_asset names); fall back to keyword match on the loaded pack.
  let assetPath: string | null = null;
  const keywords = TYPE_KEYWORDS[resolved] ?? [];
  if (keywords.length > 0) {
    assetPath = pickByKeywords(pack, keywords);
  }
  void findByFilename; // reserved for future style-library filename hints

  return {
    type: resolved,
    duration_seconds: DEFAULT_DURATION[resolved] ?? 0.25,
    asset_path: assetPath,
    source_rule: sourceRule,
  };
}

const VALID_TYPES: ReadonlySet<TransitionType> = new Set<TransitionType>([
  "hard_cut",
  "flash",
  "fade_to_black",
  "fade_from_black",
  "fade_to_white",
  "fade_from_white",
  "zoom_blur",
  "motion_blur",
  "wipe",
  "glitch",
  "light_leak",
  "dissolve",
  "overlay",
  "unknown",
]);

function isTransitionType(s: string): s is TransitionType {
  return VALID_TYPES.has(s as TransitionType);
}

// Reserved for symmetry with detection side
void function unusedTransitionEvent(_: TransitionEvent) {};
