// Maths is lifted OUT before Markdown runs and put back after. Measured 16-09-26 with
// the same marked version: "\\" line breaks became "\" (multi-line cases/aligned
// collapsed to one line) and "V^*(s) ... Q^*(s,a)" became "V^<em>(s) ... Q^</em>" --
// every Bellman equation in the RL chapter would have rendered wrong.
// Code is left alone: a "$" inside a code block is not maths.
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)(?:[^$\n\\]|\\.)+?(?<!\s)\$/g;
const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function protectMath(raw) {
    const store = [];
    const out = [];
    let last = 0;
    // Walk code spans first so maths is only looked for OUTSIDE them.
    raw.replace(CODE_PATTERN, (code, offset) => {
        out.push(liftMath(raw.slice(last, offset), store), code);
        last = offset + code.length;
        return code;
    });
    out.push(liftMath(raw.slice(last), store));
    return { text: out.join(''), store };
}

function liftMath(segment, store) {
    return segment.replace(MATH_PATTERN, match => {
        store.push(match);
        // Letters and digits only: nothing Markdown can read as syntax.
        return `KATEXSLOT${store.length - 1}END`;
    });
}

function restoreMath(html, store) {
    return html.replace(/KATEXSLOT(\d+)END/g, (_, index) => escapeHtml(store[Number(index)]));
}

// --- No Copy button on code listings (29-09-26, user, ch02 v3) ---------------
// Ruling R24 (23-09-26) put a Copy button on every <pre>. The user reversed that for the
// reader: it is explanation only, code lives in the Lab. So no <pre> gets any copy
// affordance -- including ASCII schematics, which render as plain dark cards.
// Gate: gates/gate-copy.mjs R24-2/R24-3 were rescoped in the same change to assert ZERO
// shadow-DOM Copy buttons (it used to assert one per listing).

class RichTextViewer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
    }

    static get observedAttributes() {
        return ['content'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'content' && oldValue !== newValue) {
            this.render();
        }
    }

    render() {
        const rawContent = decodeURIComponent(this.getAttribute('content') || '');
        
        // 1. Parse Markdown safely
        let htmlContent = rawContent;
        if (typeof marked !== 'undefined') {
            const { text, store } = protectMath(rawContent);
            htmlContent = restoreMath(marked.parse(text), store);
        }

        // 2. Inject HTML and Styles
        this.shadowRoot.innerHTML = `
            <style>
                @import url('https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css');
                
                :host {
                    display: block;
                    font-family: inherit;
                    line-height: inherit;   /* let the reading scale own this */
                }
                
                /* Minimal markdown styling */
                p { margin-bottom: 1em; }
                code { background: rgba(255, 255, 255, 0.1); padding: 0.2em 0.4em; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
                pre { background: #111827; padding: 1em; overflow-x: auto; border-radius: 8px; border: 1px solid #374151; }
                pre code { background: transparent; padding: 0; }
                ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 1em; }
                ol { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 1em; }
                h1, h2, h3, h4 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; color: #fff; }
                a { color: #ef5b5b; text-decoration: underline; }
                blockquote { border-left: 4px solid #ef5b5b; padding-left: 1em; color: #9ca3af; margin-left: 0; }

                /* Figures, tables and inline SVG had NO rules at all until
                   16-09-26. marked already emitted them, so a markdown image or
                   table rendered unbounded and borderless -- which is part of
                   why the theory read as an unbroken wall of prose. */
                img, svg { max-width: 100%; height: auto; display: block; }
                img { margin: 1.25em auto; border-radius: 8px; border: 1px solid #374151; background: #111827; }
                figure { margin: 1.5em 0; }
                figcaption { margin-top: 0.6em; font-size: 0.85em; color: #9ca3af; text-align: center; font-style: italic; }
                table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.92em; display: block; overflow-x: auto; }
                th, td { border: 1px solid #374151; padding: 0.55em 0.75em; text-align: left; vertical-align: top;
                         overflow-wrap: normal; word-break: normal; min-width: 6.5em; }
                /* The lesson wrapper sets overflow-wrap:anywhere (long inline code on phones); inside a
                   table that split words letter by letter, so cells keep whole words and the table
                   scrolls sideways in its own box instead (17-09-26). */
                th { background: #1f2937; color: #fff; font-weight: 600; }
                tr:nth-child(even) td { background: rgba(255, 255, 255, 0.02); }
                hr { border: 0; border-top: 1px solid #374151; margin: 2em 0; }
                /* A long display formula scrolls inside its own box; the container clips what is
                   left (KaTeX's hidden MathML copy still counts toward page width), so a phone
                   never scrolls the whole lesson sideways (17-09-26). */
                .katex-display { overflow-x: auto; overflow-y: hidden; max-width: 100%; padding: 0.25em 0; }
                li { min-width: 0; }
                .content-container { max-width: 100%; overflow-x: clip; }
            </style>
            <div class="content-container">${htmlContent}</div>
        `;

        // 3. Scan and render LaTeX inside the newly created DOM
        if (typeof renderMathInElement !== 'undefined') {
            const container = this.shadowRoot.querySelector('.content-container');
            renderMathInElement(container, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true}
                ],
                throwOnError: false
            });
        }
    }
}

customElements.define('rich-text-viewer', RichTextViewer);
