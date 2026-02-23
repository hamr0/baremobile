// Zero-dep XML parser for uiautomator dump output (pure, no I/O)

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const ENTITY_RE = /&(?:amp|lt|gt|quot|apos);/g;
function decodeEntities(s) { return s ? s.replace(ENTITY_RE, m => ENTITIES[m]) : s; }

/**
 * Parse bounds string "[x1,y1][x2,y2]" → {x1, y1, x2, y2} or null.
 * @param {string} str
 * @returns {{x1: number, y1: number, x2: number, y2: number} | null}
 */
export function parseBounds(str) {
  const m = str.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

/**
 * Parse uiautomator XML into a node tree.
 * @param {string} xml
 * @returns {object | null} root node
 */
export function parseXml(xml) {
  if (!xml || typeof xml !== 'string') return null;

  // Check for error prefix from uiautomator
  if (xml.startsWith('ERROR:')) return null;

  const nodes = [];
  const stack = [];
  const tagRe = /<node\s([^>]*?)\/?>|<\/node>/g;
  let match;

  while ((match = tagRe.exec(xml)) !== null) {
    if (match[0] === '</node>') {
      stack.pop();
      continue;
    }

    const attrs = {};
    const attrRe = /(\w[\w-]*)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(match[1])) !== null) {
      attrs[am[1]] = am[2];
    }

    const node = {
      class: attrs.class || '',
      text: decodeEntities(attrs.text || ''),
      contentDesc: decodeEntities(attrs['content-desc'] || ''),
      resourceId: attrs['resource-id'] || '',
      bounds: parseBounds(attrs.bounds || ''),
      clickable: attrs.clickable === 'true',
      scrollable: attrs.scrollable === 'true',
      editable: (attrs.class || '').includes('EditText'),
      enabled: attrs.enabled !== 'false',
      checked: attrs.checked === 'true',
      selected: attrs.selected === 'true',
      focused: attrs.focused === 'true',
      children: [],
    };

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    }

    nodes.push(node);

    // Self-closing tags don't push to stack
    if (!match[0].endsWith('/>')) {
      stack.push(node);
    }
  }

  return nodes.length > 0 ? nodes[0] : null;
}
