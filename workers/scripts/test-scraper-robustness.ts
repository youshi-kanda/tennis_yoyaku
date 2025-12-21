
import { strict as assert } from 'assert';

// Mock the extractInputValue helper function (since we cannot easily import non-exported function)
// We will copy-paste the EXACT implementation from shinagawa.ts for testing
// In a real project, we invalid export or use rewire/jest.
function extractInputValue(html: string, name: string): string | undefined {
    // 1. INPUT tag (Attribute order agnostic)
    const inputRegex = new RegExp(`<input[^>]*name=["']${name}["'][^>]*>`, 'gi');
    const inputMatch = inputRegex.exec(html);
    if (inputMatch) {
        const tag = inputMatch[0];
        const valueMatch = tag.match(/value=["']([^"']*)["']/i);
        return valueMatch ? valueMatch[1] : '';
    }

    // 2. SELECT tag
    const selectRegex = new RegExp(`<select[^>]*name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'gi');
    const selectMatch = selectRegex.exec(html);
    if (selectMatch) {
        const innerHtml = selectMatch[1];

        // Robust way: Find all options and check for selected
        const optionRegex = /<option([^>]*)>/gi;
        let match;
        let firstValue = undefined;

        while ((match = optionRegex.exec(innerHtml)) !== null) {
            const attributes = match[1];
            const valueMatch = attributes.match(/value=["']([^"']*)["']/i);
            const value = valueMatch ? valueMatch[1] : '';

            if (firstValue === undefined) firstValue = value;

            // Check for selected attribute (word boundary to avoid partial matches like 'unselected' if that existed)
            if (/\bselected\b/i.test(attributes)) {
                return value;
            }
        }

        return firstValue;
    }

    // 3. TEXTAREA tag
    const textareaRegex = new RegExp(`<textarea[^>]*name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/textarea>`, 'gi');
    const textareaMatch = textareaRegex.exec(html);
    if (textareaMatch) {
        return textareaMatch[1].trim();
    }

    return undefined;
}

// Mock Link Extraction Logic
function extractLinks(html: string) {
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    const linkMatch = html.match(/(?:href|action)=["']([^"']*(?:instNo|dateNo|timeNo)[^"']*)["']/i);

    if (linkMatch) {
        let rawUrl = linkMatch[1];
        rawUrl = rawUrl.replace(/&amp;/g, '&');
        const absUrl = new URL(rawUrl, baseUrl);
        const sp = absUrl.searchParams;
        return {
            instNo: sp.get('instNo') || '',
            dateNo: sp.get('dateNo') || '',
            timeNo: sp.get('timeNo') || ''
        };
    }
    return null;
}

// ==========================================
// TEST CASES
// ==========================================

async function runTests() {
    console.log('=== Scraper Robustness Tests ===');

    // Case 1: Standard Input (name then value)
    let html = `<input type="hidden" name="testKey" value="testVal">`;
    assert.equal(extractInputValue(html, 'testKey'), 'testVal', 'Case 1 Failed');
    console.log('✅ Case 1: Standard Input');

    // Case 2: Reversed Input (value then name)
    html = `<input value="reversedVal" type="hidden" name="testKey">`;
    assert.equal(extractInputValue(html, 'testKey'), 'reversedVal', 'Case 2 Failed');
    console.log('✅ Case 2: Reversed Input');

    // Case 3: Select (Selected)
    html = `
        <select name="mySelect">
            <option value="A">Opt A</option>
            <option value="B" selected>Opt B</option>
            <option value="C">Opt C</option>
        </select>
    `;
    assert.equal(extractInputValue(html, 'mySelect'), 'B', 'Case 3 Failed');
    console.log('✅ Case 3: Select (Selected)');

    // Case 4: Select (Default First)
    html = `
        <select name="mySelect">
            <option value="X">Opt X</option>
            <option value="Y">Opt Y</option>
        </select>
    `;
    assert.equal(extractInputValue(html, 'mySelect'), 'X', 'Case 4 Failed');
    console.log('✅ Case 4: Select (Default First)');

    // Case 5: Textarea
    html = `<textarea name="comment">Hello World</textarea>`;
    assert.equal(extractInputValue(html, 'comment'), 'Hello World', 'Case 5 Failed');
    console.log('✅ Case 5: Textarea');

    // Case 6: URL Extraction (Standard)
    html = `<a href="action.do?instNo=111&dateNo=222&timeNo=333">Confirm</a>`;
    let links = extractLinks(html);
    assert.deepEqual(links, { instNo: '111', dateNo: '222', timeNo: '333' }, 'Case 6 Failed');
    console.log('✅ Case 6: URL Extraction (Standard)');

    // Case 7: URL Extraction (HTML Entities &amp;)
    html = `<form action="action.do?instNo=AAA&amp;dateNo=BBB&amp;timeNo=CCC">`;
    links = extractLinks(html);
    assert.deepEqual(links, { instNo: 'AAA', dateNo: 'BBB', timeNo: 'CCC' }, 'Case 7 Failed');
    console.log('✅ Case 7: URL Extraction (HTML Entities)');

    // Case 8: URL Extraction (Relative path)
    html = `<a href="./sub/action.do?instNo=Rel1&dateNo=Rel2&timeNo=Rel3">Link</a>`;
    links = extractLinks(html);
    assert.deepEqual(links, { instNo: 'Rel1', dateNo: 'Rel2', timeNo: 'Rel3' }, 'Case 8 Failed');
    console.log('✅ Case 8: URL Extraction (Relative)');

    console.log('🎉 All Robustness Tests Passed!');
}

runTests().catch(e => {
    console.error('❌ Test Failed:', e);
    process.exit(1);
});
