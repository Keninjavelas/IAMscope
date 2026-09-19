/**
 * IAMScope design system (Plan §15.3).
 *
 * Re-exports every primitive so feature code can `import { Button, Table } from '@/components/ui'`.
 */
export { Avatar, tintForName } from './Avatar';
export type { AvatarProps, AvatarSize } from './Avatar';

export { AvatarStack } from './AvatarStack';
export type { AvatarStackProps, AvatarUser } from './AvatarStack';

export { Badge } from './Badge';
export type { BadgeProps, BadgeSize, BadgeVariant } from './Badge';

export { Button, IconButton, buttonClassName } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './Button';

export { CodeEditor } from './CodeEditor';
export type { CodeEditorLanguage, CodeEditorProps } from './CodeEditor';

export { Combobox } from './Combobox';
export type { ComboboxItem, ComboboxProps } from './Combobox';

export { CommandDialog } from './Command';
export type { CommandDialogProps, CommandEntry, CommandGroup } from './Command';

export { ContextMenu } from './ContextMenu';
export type { ContextMenuItem, ContextMenuProps } from './ContextMenu';

export { Dialog } from './Dialog';
export type { DialogProps, DialogSize } from './Dialog';

export { Drawer } from './Drawer';
export type { DrawerProps, DrawerSide, DrawerSize } from './Drawer';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { ErrorState, describeUnknownError } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';

export { Input } from './Input';
export type { InputProps } from './Input';

export { JsonDiff, buildDiffLines, diffWords, flattenJson } from './JsonDiff';
export type { DiffKind, DiffSegment, JsonDiffLine, JsonDiffMode, JsonDiffProps } from './JsonDiff';

export { Kbd } from './Kbd';
export type { KbdProps } from './Kbd';

export { PageHeader } from './PageHeader';
export type { Breadcrumb, PageHeaderProps } from './PageHeader';

export { PagePlaceholder } from './PagePlaceholder';
export type { PagePlaceholderProps } from './PagePlaceholder';

export { HoverPreview, Popover } from './Popover';
export type { HoverPreviewProps, PopoverAlign, PopoverProps, PopoverSide } from './Popover';

export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';

export { Skeleton, SkeletonRows } from './Skeleton';
export type { SkeletonProps, SkeletonRowsProps, SkeletonVariant } from './Skeleton';

export { Table } from './Table';
export type { Column, SortState, TableProps } from './Table';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { MAX_VISIBLE_TOASTS, Toaster, ToastToaster, useToast, useToastStore } from './Toast';
export type {
  ToastAction,
  ToastApi,
  ToastItem,
  ToastOptions,
  ToastVariant,
  UndoableOptions,
} from './Toast';

export { Tooltip, TooltipProvider } from './Tooltip';
export type { TooltipProps } from './Tooltip';

export { Toolbar, ToolbarSpacer } from './Toolbar';
export type { ToolbarProps, ToolbarSpacerProps } from './Toolbar';
