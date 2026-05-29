// Shared cross-file type definitions. JSDoc @typedef here generates its own
// types/types.d.ts — preferred over a hand-written .d.ts (LIBRARY_CONVENTIONS §2.6).
// This module has no runtime exports; it exists purely to host shared shapes.

/**
 * A node in the accessibility tree. Produced by xml.js (Android, via parseXml)
 * and ios.js (iOS, via translateWda) in the same shape, then consumed by the
 * shared prune() + formatTree() pipeline. Most fields are optional because the
 * pruning pipeline mutates nodes in place and synthesises partial sentinel
 * nodes (e.g. the "…" truncation marker).
 *
 * @typedef {object} UiNode
 * @property {string} [class]
 * @property {string} [text]
 * @property {string} [contentDesc]
 * @property {string} [resourceId]
 * @property {{x1: number, y1: number, x2: number, y2: number} | null} [bounds]
 * @property {boolean} [clickable]
 * @property {boolean} [scrollable]
 * @property {boolean} [editable]
 * @property {boolean} [enabled]
 * @property {boolean} [checked]
 * @property {boolean} [selected]
 * @property {boolean} [focused]
 * @property {number} [ref]
 * @property {UiNode[]} children
 */

export {};
