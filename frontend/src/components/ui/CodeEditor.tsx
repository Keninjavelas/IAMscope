import { useEffect, useRef, type JSX } from 'react';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { cn } from '@/lib/cn';

export type CodeEditorLanguage = 'json' | 'text';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: CodeEditorLanguage | undefined;
  readOnly?: boolean | undefined;
  height?: number | string | undefined;
  error?: string | null | undefined;
  /** Required: the editor is a textarea-shaped control and needs a name. */
  ariaLabel: string;
  onSave?: (() => void) | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}

/**
 * One-dark-flavoured theme expressed entirely in IAMScope tokens, so the editor
 * follows `data-theme` like every other surface.
 */
const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--bg-inset)',
      color: 'var(--text)',
      fontSize: '12px',
      height: '100%',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.5',
      overflow: 'auto',
    },
    '.cm-content': { padding: '8px 0', caretColor: 'var(--text)' },
    '.cm-line': { padding: '0 10px' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-inset)',
      color: 'var(--text-subtle)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--text-muted)' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-subtle)' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-subtle)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
    '.cm-matchingBracket': {
      backgroundColor: 'var(--bg-active)',
      outline: '1px solid var(--border-strong)',
    },
    '.cm-lint-marker-error': { content: 'none' },
    '.cm-lintRange-error': { textDecoration: 'underline wavy var(--danger)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-overlay)',
      border: '1px solid var(--border-strong)',
      color: 'var(--text)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--bg-selected)',
      color: 'var(--text)',
    },
    '.cm-searchMatch': { backgroundColor: 'var(--warn-subtle)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-subtle)' },
  },
  { dark: true },
);

const oneDarkTokens = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--text-subtle)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--accent)' },
  { tag: tags.string, color: 'var(--success)' },
  { tag: tags.number, color: 'var(--severity-medium)' },
  { tag: tags.bool, color: 'var(--accent)' },
  { tag: tags.null, color: 'var(--text-subtle)' },
  { tag: tags.propertyName, color: 'var(--info)' },
  { tag: tags.punctuation, color: 'var(--text-muted)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

const readOnlyCompartment = new Compartment();

/**
 * CodeMirror 6 editor (Plan §5.2, §15.3).
 *
 * The wrapper carries `data-keyboard-scope="editor"` so `useKeyboard` refuses to
 * fire global shortcuts (`g p`, `c`, `e`) while the author is typing - that is
 * the whole contract of that attribute.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  height = 320,
  error = null,
  ariaLabel,
  onSave,
  placeholder,
  className,
}: CodeEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const readOnlyRef = useRef(readOnly);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  readOnlyRef.current = readOnly;

  // Mount once: recreating the view on every render would reset history/cursor.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      editorTheme,
      syntaxHighlighting(oneDarkTokens),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current?.();
            return true;
          },
        },
        indentWithTab,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true' }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        onChangeRef.current(update.state.doc.toString());
      }),
      readOnlyCompartment.of([
        EditorState.readOnly.of(readOnlyRef.current),
        EditorView.editable.of(!readOnlyRef.current),
      ]),
    ];

    if (language === 'json') {
      extensions.push(json(), lintGutter(), linter(jsonParseLinter()));
    }

    if (placeholder !== undefined && placeholder !== '') {
      extensions.push(placeholderExtension(placeholder));
    }

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally mount-only: `value` sync and props are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel, language]);

  // Push external changes (e.g. "format", "revert", switching statements/JSON).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  // Toggle read-only without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  const resolvedHeight = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      data-keyboard-scope="editor"
      className={cn(
        'overflow-hidden rounded-input border bg-bg-inset',
        error ? 'border-danger' : 'border-border-strong',
        className,
      )}
      style={{ height: resolvedHeight }}
    >
      <div ref={hostRef} className="h-full" />
    </div>
  );
}
