import { type CSSProperties, type FC, type SVGProps } from "react";
import { cn } from "./utils";
import { CentralIcon, type CentralIconVariant } from "./central-icons";

// Keep the existing icon API stable while rendering app controls with Central assets.
export type LucideIcon = FC<SVGProps<SVGSVGElement>>;

// Wraps a Central icon asset behind the LucideIcon API. Rendering via CSS mask
// avoids stroke-on-stroke alpha summation that gave hand-drawn SVGs a
// "stamped twice" look on shared vertices (the previous PinIcon bug).
function centralIconWrapper(name: string, variant?: CentralIconVariant): LucideIcon {
  return function CentralIconWrapper({ className, style, role, ...rest }) {
    const ariaLabelRaw = (rest as { ["aria-label"]?: unknown })["aria-label"];
    const label = typeof ariaLabelRaw === "string" ? ariaLabelRaw : undefined;
    const ariaHidden = (rest as { ["aria-hidden"]?: boolean | "true" | "false" })["aria-hidden"];
    return (
      <CentralIcon
        name={name}
        variant={variant}
        className={typeof className === "string" ? className : undefined}
        style={style as CSSProperties | undefined}
        label={label}
        role={typeof role === "string" ? role : undefined}
        aria-hidden={ariaHidden}
      />
    );
  };
}

export const AppsIcon: LucideIcon = centralIconWrapper("apps");
// Composer stacked-panel glyphs (subagent strip / workflow run card).
export const BackgroundTrayIcon: LucideIcon = centralIconWrapper("arrow-down-wall");
export const ContextCompactionIcon: LucideIcon = centralIconWrapper("arrows-hide");
export const PanelExpandIcon: LucideIcon = centralIconWrapper("expand-45");
export const PanelCollapseIcon: LucideIcon = centralIconWrapper("minimize-45");
export const BackToParentIcon: LucideIcon = centralIconWrapper("arrow-share-left");
export const WorkflowIcon: LucideIcon = centralIconWrapper("group-1");
export const SteerIcon: LucideIcon = centralIconWrapper("arrow-corner-down-right");
export const ComposerSendArrowIcon: LucideIcon = centralIconWrapper("arrow-up");
export const HANDOFF_ICON_NAME = "arrows-repeat-right-left";
export const HandoffIcon: LucideIcon = centralIconWrapper(HANDOFF_ICON_NAME);
export const SKILL_ICON_NAME = "building-blocks";
export const SkillCubeIcon: LucideIcon = centralIconWrapper(SKILL_ICON_NAME);
export const NewThreadIcon: LucideIcon = centralIconWrapper("edit-big");
/** The "+" affordance behind every add/create action (Add project, activity header). */
export const AddPlusIcon: LucideIcon = centralIconWrapper("plus-medium");
/** 2x3 dot grip for drag-to-reorder handles (provider rows, sidebar nav customize). */
export const DragHandleIcon: LucideIcon = centralIconWrapper("dot-grid-2x3");
/** Sliders glyph for "customize this surface" entries. */
export const CustomizeIcon: LucideIcon = centralIconWrapper("settings-slider-three");
export const EraserIcon: LucideIcon = centralIconWrapper("eraser");
export const ArrowLeftIcon = centralIconWrapper("arrow-left");
export const ArrowRightIcon = centralIconWrapper("arrow-right");
export const ArrowDownIcon = centralIconWrapper("arrow-down");
export const ArrowUpIcon = centralIconWrapper("arrow-up");
export const ArrowUpRightIcon = centralIconWrapper("arrow-up-right");
export const SortIcon: LucideIcon = centralIconWrapper("arrow-top-bottom");
// Legacy Graft uses group-1 for subagents and swarm controls. Share it with
// imperative composer chips through AGENT_ICON_NAME.
export const AGENT_ICON_NAME = "group-1";
export const BotIcon: LucideIcon = centralIconWrapper(AGENT_ICON_NAME);
export const BookIcon: LucideIcon = centralIconWrapper("book-simple");
export const BugIcon = centralIconWrapper("bug");
export const CameraIcon = centralIconWrapper("camera-1");
export const CheckIcon = centralIconWrapper("checkmark-1");
export const ChevronDownIcon = centralIconWrapper("chevron-bottom");
export const ChevronLeftIcon = centralIconWrapper("chevron-left");
export const ChevronRightIcon = centralIconWrapper("chevron-right");
export const ChevronUpIcon = centralIconWrapper("chevron-top");
export const ChevronsUpDownIcon = centralIconWrapper("chevron-grabber-vertical");
export const CircleAlertIcon = centralIconWrapper("exclamation-circle");
export const CircleCheckIcon = centralIconWrapper("circle-check");
// Completed/success status glyph sourced from the Central set so it sits in the
// same visual language as the other trailing thread-row icons (worktree, fork,
// pull-request) instead of the react-icons outline check it replaced.
export const CheckCircle2Icon: LucideIcon = centralIconWrapper("circle-check");
// User-input rows: a question-mark circle while the agent waits for an answer,
// and an up-arrow circle once the answer is submitted. Sourced from the Central
// set so they sit visually beside the other timeline glyphs (robot, search, …).
export const CircleQuestionIcon: LucideIcon = centralIconWrapper("circle-questionmark");
export const ArrowUpCircleIcon: LucideIcon = centralIconWrapper("arrow-up-circle");
export const CloudSyncIcon = centralIconWrapper("cloud-sync");
export const Columns2Icon = centralIconWrapper("layout-column");
export const ChangesIcon = centralIconWrapper("changes");
export const COPY_ICON_NAME = "square-behind-square-1";
export const CopyIcon = centralIconWrapper(COPY_ICON_NAME);
export const LinkIcon = centralIconWrapper("chain-link-3");
export const DiffIcon = centralIconWrapper("difference-modified");
export const DownloadIcon = centralIconWrapper("cloud-download");
export const ImportThreadIcon: LucideIcon = centralIconWrapper("arrow-inbox");
export const FolderPlusIcon: LucideIcon = centralIconWrapper("folder-add-right");
export const CornerLeftUpIcon: LucideIcon = centralIconWrapper("arrow-corner-left-up");
export const RaisingHandIcon: LucideIcon = centralIconWrapper("raising-hand-5-finger");
// The clock doubles as the automation glyph everywhere it appears (meta chip,
// Automations nav, slash command, created card, environment section), so it is
// sourced from the Central icon set rather than the Tabler stroke icon.
export const BELL_ICON_NAME = "bell";
export const BellIcon: LucideIcon = centralIconWrapper(BELL_ICON_NAME);
export const ClockIcon = centralIconWrapper("clock");
export const EllipsisIcon = centralIconWrapper("dot-grid-1x3-horizontal");
export const ExternalLinkIcon = centralIconWrapper("arrow-out-of-box");
// Markdown Source/Preview toggle glyphs, sourced from the Central set so the
// file-preview header controls share one visual language with the rest of the
// chrome (raw source = code brackets, rendered preview = open eye).
export const CodeIcon: LucideIcon = centralIconWrapper("code");
export const EYE_OPEN_ICON_NAME = "eye-open";
export const EyeOpenIcon: LucideIcon = centralIconWrapper(EYE_OPEN_ICON_NAME);
export const EyeIcon = EyeOpenIcon;
export const PaperclipIcon = centralIconWrapper("paperclip-1");
export const ARCHIVE_ICON_NAME = "archive";
export const ArchiveIcon = centralIconWrapper(ARCHIVE_ICON_NAME);
export const BrainIcon = centralIconWrapper("brain-1");
export const FileIcon = centralIconWrapper("files");
export const FlagIcon = centralIconWrapper("flag-1");
export const FlaskConicalIcon = centralIconWrapper("lab");
export const FolderIcon = centralIconWrapper("folder-1");
export const FolderOpenIcon = centralIconWrapper("folder-open");
// Stacked "folders" glyph used as the single representation of a file tree /
// explorer surface (right-dock explorer, editor Files activity, diff file-tree
// toggle). Central rounded outline asset so it matches the rest of the chrome.
export const FoldersIcon: LucideIcon = centralIconWrapper("folders");
export const GiftIcon: LucideIcon = centralIconWrapper("gift-2");
export const GitCommitIcon: LucideIcon = centralIconWrapper("commits");
export const GitBranchIcon: LucideIcon = centralIconWrapper("branch");
// Match legacy Graft’s separate fork and branch affordances.
export const GitForkIcon: LucideIcon = centralIconWrapper("fork-code");
export const GitMergeIcon: LucideIcon = centralIconWrapper("merged");
export const GitMergedSimpleIcon: LucideIcon = centralIconWrapper("merged-simple");
export const PushIcon: LucideIcon = centralIconWrapper("cloud-upload");
export const GitHubIcon: LucideIcon = centralIconWrapper("github");
export const GitPullRequestIcon = centralIconWrapper("pull-request");
// Pull-request state glyphs from the same three-node Central family as "pull-request",
// so draft/closed/merged read as variations of one icon rather than four styles.
export const GitPullRequestDraftIcon: LucideIcon = centralIconWrapper("draft");
export const GitPullRequestClosedIcon: LucideIcon = centralIconWrapper(
  "pull-request-closed-simple",
);
export const GitMergeConflictIcon: LucideIcon = centralIconWrapper("merge-conflict");
// Three descending-width lines — the app's one "filter controls" glyph (pull
// request list filters, and anywhere else that opens a filter popover).
export const FilterIcon: LucideIcon = centralIconWrapper("filter-2");
// Two-person glyph for "reviewers"/"people" rows (pull request meta grid).
export const UsersIcon: LucideIcon = centralIconWrapper("people");
// Legacy Graft distinguishes browser/world from web search.
export const GlobeIcon: LucideIcon = centralIconWrapper("world");
export const WebSearchIcon: LucideIcon = centralIconWrapper("search-intelligence");
// Handset glyph for the iOS Simulator dock pane.
export const DeviceMobileIcon: LucideIcon = centralIconWrapper("phone");
// Hardware-button glyphs for the simulator's control rail.
export const DeviceHomeIcon: LucideIcon = centralIconWrapper("home");
export const DeviceShutterIcon: LucideIcon = centralIconWrapper("camera-1");
// Simulator toolbar actions use the same Central set as the rest of the chrome.
export const DeviceRecordIcon: LucideIcon = centralIconWrapper("record");
export const DeviceRecordStopIcon: LucideIcon = centralIconWrapper("stop", "fill");
export const DeviceRotateIcon = centralIconWrapper("arrow-rotate-clockwise");
export const DevicePowerIcon = centralIconWrapper("stop-circle");
export const DeviceDetachIcon = centralIconWrapper("broken-chain-link-3");
export const McpIcon = centralIconWrapper("modelcontextprotocol");
export const PluginIcon: LucideIcon = centralIconWrapper("plugin-1");
// Single hammer/build glyph (tool-call rows, codex provider, "build" scripts).
// Sourced from the Central set so it matches the other work-row icons (pencil,
// terminal, skill cube) it sits beside, instead of the Tabler wrench it used to be.
export const HammerIcon: LucideIcon = centralIconWrapper("hammer");
export const HistoryIcon = centralIconWrapper("history");
export const InfoIcon = centralIconWrapper("info-simple");
export const KanbanIcon = centralIconWrapper("tasks");
export const KeyboardIcon: LucideIcon = centralIconWrapper("keyboard");
export const ListChecksIcon = centralIconWrapper("checklist");
export const ListTodoIcon = centralIconWrapper("tasks");
export const PlanIcon = centralIconWrapper("compass-round");
export const Loader2Icon = centralIconWrapper("loader");
export const LoaderCircleIcon = Loader2Icon;
export const LoaderIcon = Loader2Icon;
export const Maximize2 = PanelExpandIcon;
export const Minimize2 = PanelCollapseIcon;
export const MessageCircleIcon = centralIconWrapper("chat-bubble-7");
export const MinusIcon = centralIconWrapper("minus-medium");
export const ChatBubbleIcon: LucideIcon = centralIconWrapper("chat-bubble-7");
// Canonical side-chat glyph — every sidechat surface (right dock pane, environment
// panel rows, tabs) must use this one so the feature reads consistently.
export const SidechatIcon: LucideIcon = centralIconWrapper("chat-bubble-7");
export const MicIcon: LucideIcon = centralIconWrapper("microphone");
export const PanelLeftIcon = centralIconWrapper("sidebar-simple-left-square");
export const PanelRightCloseIcon = centralIconWrapper("layout-right");
export const BulletListIcon = centralIconWrapper("bullet-list");
export const SidebarHiddenRightWideIcon = centralIconWrapper("sidebar-hidden-right-wide");
export const BottombarHiddenBottomWideIcon = centralIconWrapper("bottombar-hidden-bottom-wide");
export const WindowIcon: LucideIcon = centralIconWrapper("window");
export const LayoutSidebarIcon: LucideIcon = centralIconWrapper("sidebar-simple-left-square");
export const PENCIL_ICON_NAME = "pencil";
export const PencilIcon: LucideIcon = centralIconWrapper(PENCIL_ICON_NAME);
export const PIN_ICON_NAME = "pin";
export const PinIcon: LucideIcon = centralIconWrapper(PIN_ICON_NAME);
// Solid pin from the fill set — used wherever a pin reflects "pinned" status
// (project + thread rows and their hover cards) rather than a neutral action.
export const PinFilledIcon: LucideIcon = centralIconWrapper("pin", "fill");
export const PauseIcon: LucideIcon = centralIconWrapper("pause", "fill");
export const PlayIcon: LucideIcon = centralIconWrapper("play");
// Outline transport glyphs (Central "reversed" set) for surfaces that read as a
// row of neutral actions rather than playback state — e.g. the composer goal strip.
export const PauseOutlineIcon: LucideIcon = centralIconWrapper("pause");
export const PlayOutlineIcon: LucideIcon = centralIconWrapper("play");
export const TRASH_ICON_NAME = "trash-can";
export const TrashCanIcon: LucideIcon = centralIconWrapper(TRASH_ICON_NAME);
// Persistent thread goal ("Pursuing goal" strip, /goal surfaces).
export const GoalIcon: LucideIcon = centralIconWrapper("target-arrow");
export const Plus = AddPlusIcon;
export const PlusIcon = AddPlusIcon;
export const RefreshCwIcon = centralIconWrapper("arrow-rotate-clockwise");
export const RotateCcwIcon = centralIconWrapper("arrow-rotate-counter-clockwise");
export const Rows3Icon = centralIconWrapper("layout-half");
export const SearchIcon: LucideIcon = centralIconWrapper("magnifying-glass");
// Single source for the settings gear. Every settings affordance renders this
// one Central glyph so gears stay identical across the chrome.
export const SettingsIcon: LucideIcon = centralIconWrapper("settings-gear-1");
export const StarIcon = centralIconWrapper("star");
export const StarFilledIcon = centralIconWrapper("star", "fill");
export const SunIcon = centralIconWrapper("sun");
export const MoonIcon = centralIconWrapper("moon");
export const DeviceLaptopIcon = centralIconWrapper("macbook");
export const StopIcon: LucideIcon = centralIconWrapper("stop", "fill");
export const StopFilledIcon: LucideIcon = centralIconWrapper("stop", "fill");
export const SquareSplitHorizontal = Columns2Icon;
export const SquareSplitVertical = Rows3Icon;
const TemporaryThreadGlyph = centralIconWrapper("bubble-annotation-5");
// Dotted "annotation" chat bubble — the temporary thread marker shown on the
// composer toggle and beside temporary threads in the sidebar.
export const TemporaryThreadIcon: LucideIcon = ({ className, ...props }) => (
  <TemporaryThreadGlyph className={cn("size-3.5 shrink-0", className)} {...props} />
);
export const TERMINAL_ICON_NAME = "console";
export const TerminalIcon = centralIconWrapper(TERMINAL_ICON_NAME);
export const TerminalSquare = centralIconWrapper("console");
export const TerminalSquareIcon = centralIconWrapper("console");
export const TextWrapIcon = centralIconWrapper("linebreak");
export const Trash2 = TrashCanIcon;
export const TriangleAlertIcon = centralIconWrapper("exclamation-triangle");
export const Undo2Icon = centralIconWrapper("arrow-undo-up");
export const ResetIcon: LucideIcon = centralIconWrapper("arrow-rotate-counter-clockwise");
export const Redo2Icon = centralIconWrapper("arrow-redo-down");
export const WorktreeIcon = centralIconWrapper("arrow-split-right");
export const XIcon = centralIconWrapper("cross-medium");
export const ZapIcon = centralIconWrapper("zap");
// Single source for the fast-mode glyph. Every fast-mode affordance (composer
// trait badges, the effort-header toggle, the /fast command) renders this one solid
// lightning bolt from the Central fill set instead of mixing Tabler/Ionicons bolts.
export const FastModeIcon: LucideIcon = centralIconWrapper("zap", "fill");
// Outline twin of FastModeIcon (Central reversed set) for the inactive toggle state.
export const FastModeOutlineIcon: LucideIcon = centralIconWrapper("zap");
