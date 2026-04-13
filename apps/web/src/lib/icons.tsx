// @ts-nocheck
import { type FC, type SVGProps } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpDown,
  Bot,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleCheck,
  CloudUpload,
  Columns2,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  File,
  FlaskConical,
  Folder,
  FolderOpen,
  GitCommitHorizontal,
  GitCompare,
  GitFork,
  GitPullRequest,
  Globe,
  Info,
  LayoutGrid,
  LayoutPanelLeft,
  ListChecks,
  ListTodo,
  Loader2,
  Lock,
  LockOpen,
  Maximize2 as LucideMaximize2,
  Minimize2 as LucideMinimize2,
  PanelLeft,
  PanelLeftClose,
  PanelRightClose,
  Pin,
  Play,
  Plug as LucidePlug,
  Plus as LucidePlus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Rows3,
  Search,
  Settings,
  SquarePen,
  SquareSplitHorizontal as LucideSplitH,
  SquareSplitVertical as LucideSplitV,
  Terminal,
  TerminalSquare as LucideTermSq,
  TextWrap,
  Trash2 as LucideTrash2,
  Undo2,
  Wrench,
  X,
  Zap,
  type LucideProps,
} from "lucide-react";

export type LucideIcon = FC<SVGProps<SVGSVGElement>>;

function adaptIcon(Component: FC<LucideProps>): LucideIcon {
  return function AdaptedIcon(props) {
    return <Component className={props.className} style={props.style} />;
  };
}

export const AppsIcon = adaptIcon(LayoutGrid);
export const ArrowLeftIcon = adaptIcon(ArrowLeft);
export const ArrowRightIcon = adaptIcon(ArrowRight);
export const ArrowDownIcon = adaptIcon(ArrowDown);
export const ArrowUpDownIcon = adaptIcon(ArrowUpDown);
export const BotIcon = adaptIcon(Bot);
export const BugIcon = adaptIcon(Bug);
export const CheckIcon = adaptIcon(Check);
export const ChevronDownIcon = adaptIcon(ChevronDown);
export const ChevronLeftIcon = adaptIcon(ChevronLeft);
export const ChevronRightIcon = adaptIcon(ChevronRight);
export const ChevronUpIcon = adaptIcon(ChevronUp);
export const ChevronsUpDownIcon = adaptIcon(ChevronsUpDown);
export const CircleAlertIcon = adaptIcon(AlertCircle);
export const CircleCheckIcon = adaptIcon(CircleCheck);
export const CloudUploadIcon = adaptIcon(CloudUpload);
export const Columns2Icon = adaptIcon(Columns2);
export const CopyIcon = adaptIcon(Copy);
export const DiffIcon = adaptIcon(GitCompare);
export const EllipsisIcon = adaptIcon(Ellipsis);
export const ExternalLinkIcon = adaptIcon(ExternalLink);
export const EyeIcon = adaptIcon(Eye);
export const FileIcon = adaptIcon(File);
export const FlaskConicalIcon = adaptIcon(FlaskConical);
export const FolderClosedIcon = adaptIcon(Folder);
export const FolderIcon = adaptIcon(Folder);
export const FolderOpenIcon = adaptIcon(FolderOpen);
export const GitCommitIcon = adaptIcon(GitCommitHorizontal);
export const GitForkIcon = adaptIcon(GitFork);
export const GitPullRequestIcon = adaptIcon(GitPullRequest);
export const GlobeIcon = adaptIcon(Globe);
export const PlugIcon = adaptIcon(LucidePlug);
export const HammerIcon = adaptIcon(Wrench);
export const HandoffIcon = adaptIcon(ArrowRightLeft);
export const InfoIcon = adaptIcon(Info);
export const ListChecksIcon = adaptIcon(ListChecks);
export const ListTodoIcon = adaptIcon(ListTodo);
export const Loader2Icon = adaptIcon(Loader2);
export const LoaderCircleIcon = adaptIcon(Loader2);
export const LoaderIcon = adaptIcon(Loader2);
export const LockIcon = adaptIcon(Lock);
export const LockOpenIcon = adaptIcon(LockOpen);
export const Maximize2 = adaptIcon(LucideMaximize2);
export const Minimize2 = adaptIcon(LucideMinimize2);
export const PanelLeftCloseIcon = adaptIcon(PanelLeftClose);
export const PanelLeftIcon = adaptIcon(PanelLeft);
export const PanelRightCloseIcon = adaptIcon(PanelRightClose);
export const PinIcon = adaptIcon(Pin);
export const PinnedFilledIcon = adaptIcon(Pin);
export const PlayIcon = adaptIcon(Play);
export const Plus = adaptIcon(LucidePlus);
export const PlusIcon = adaptIcon(LucidePlus);
export const RefreshCwIcon = adaptIcon(RefreshCw);
export const RocketIcon = adaptIcon(Rocket);
export const RotateCcwIcon = adaptIcon(RotateCcw);
export const Rows3Icon = adaptIcon(Rows3);
export const SearchIcon = adaptIcon(Search);
export const SettingsIcon = adaptIcon(Settings);
export const SquarePenIcon = adaptIcon(SquarePen);
export const SquareSplitHorizontal = adaptIcon(LucideSplitH);
export const SquareSplitVertical = adaptIcon(LucideSplitV);
export const TerminalIcon = adaptIcon(Terminal);
export const TerminalSquare = adaptIcon(LucideTermSq);
export const TerminalSquareIcon = adaptIcon(LucideTermSq);
export const TextWrapIcon = adaptIcon(TextWrap);
export const Trash2 = adaptIcon(LucideTrash2);
export const TriangleAlertIcon = adaptIcon(AlertTriangle);
export const Undo2Icon = adaptIcon(Undo2);
export const WrenchIcon = adaptIcon(Wrench);
export const XIcon = adaptIcon(X);
export const ZapIcon = adaptIcon(Zap);
