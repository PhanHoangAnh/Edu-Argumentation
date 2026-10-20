const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { extractPdfText } = require('../book_to_questions');

function createPdf(text) {
    const escapedText = text.replace(/[\\()]/g, '\\$&');
    const stream = text
        ? `BT /F1 18 Tf 72 720 Td (${escapedText}) Tj ET`
        : 'q Q';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
    ];
    const offsets = [0];
    let document = '%PDF-1.4\n';

    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(document));
        document += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const crossReferenceOffset = Buffer.byteLength(document);
    document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`;
    return Buffer.from(document);
}

async function withPdfFixture(t, text) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-argumentation-pdf-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'fixture.pdf');
    await fs.writeFile(filePath, createPdf(text));
    return filePath;
}

test('extracts text from a PDF page', async t => {
    const inputPath = await withPdfFixture(t, 'PDF extraction smoke test');
    assert.equal(await extractPdfText(inputPath), 'PDF extraction smoke test');
});

test('reports PDFs with no extractable text', async t => {
    const inputPath = await withPdfFixture(t, '');
    await assert.rejects(
        extractPdfText(inputPath),
        /Scanned or image-only PDFs require OCR first/
    );
});
