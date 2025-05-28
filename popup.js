document.addEventListener('DOMContentLoaded', function() {
  const convertBtn = document.getElementById('convertBtn');
  const amazonBtn = document.getElementById('amazonBtn');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');
  const promptText = document.getElementById('promptText');
  const promptActionBtn = document.getElementById('promptActionBtn');
  let markdownContent = '';
  let isPromptEditable = true;

  // Tab switching functionality
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab') + '-tab';
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Load saved prompt on popup open
  chrome.storage.local.get(['savedPrompt'], function(result) {
    if (result.savedPrompt) {
      promptText.value = result.savedPrompt;
      // If there's a saved prompt, start in non-editable mode
      togglePromptEditability(false);
    }
  });

  promptActionBtn.addEventListener('click', () => {
    if (isPromptEditable) {
      // Save mode
      const prompt = promptText.value.trim();
      if (prompt) {
        chrome.storage.local.set({ savedPrompt: prompt }, function() {
          showStatus('Prompt saved successfully!', 'success');
          togglePromptEditability(false);
        });
      } else {
        showStatus('Please enter a prompt', 'error');
      }
    } else {
      // Edit mode
      togglePromptEditability(true);
    }
  });

  function togglePromptEditability(editable) {
    isPromptEditable = editable;
    promptText.disabled = !editable;
    promptActionBtn.textContent = editable ? 'Save Prompt' : 'Edit Prompt';
    promptActionBtn.className = editable ? 'save-prompt-btn' : 'edit-prompt-btn';
  }

  convertBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Get the current prompt text
      const currentPrompt = promptText.value.trim();
      
      // Execute the convertToMarkdown function in the current tab
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: convertToMarkdown,
        args: [currentPrompt]
      });

      if (result && result[0] && result[0].result) {
        markdownContent = result[0].result;
        
        // Copy to clipboard
        await navigator.clipboard.writeText(markdownContent);
        showStatus('Markdown copied to clipboard!', 'success');
        saveBtn.disabled = false;
      } else {
        throw new Error('Failed to convert page to markdown');
      }
    } catch (error) {
      showStatus('Error: ' + error.message, 'error');
    }
  });

  amazonBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Get the current prompt text
      const currentPrompt = promptText.value.trim();
      
      // Execute the scrapeAmazonProduct function in the current tab
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: scrapeAmazonProduct,
        args: [currentPrompt]
      });

      if (result && result[0] && result[0].result) {
        markdownContent = result[0].result;
        
        // Copy to clipboard
        await navigator.clipboard.writeText(markdownContent);
        showStatus('Amazon product details copied to clipboard!', 'success');
        saveBtn.disabled = false;
      } else {
        throw new Error('Failed to scrape Amazon product');
      }
    } catch (error) {
      showStatus('Error: ' + error.message, 'error');
    }
  });

  saveBtn.addEventListener('click', () => {
    if (markdownContent) {
      const blob = new Blob([markdownContent], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const filename = `page-${new Date().toISOString().slice(0, 10)}.md`;

      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          showStatus('Error saving file: ' + chrome.runtime.lastError.message, 'error');
        } else {
          showStatus('File saved successfully!', 'success');
        }
      });
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
});

// Function to convert page content to markdown
function convertToMarkdown(prompt) {
  const excludeSelectors = [
    'script',
    'style',
    'noscript',
    'iframe',
    'nav',
    'footer',
    'header',
    '.ad',
    '.advertisement',
    '.banner',
    '.cookie-notice',
    '.popup',
    '.modal',
    '.sidebar',
    '.menu',
    '.navigation',
    '.social-share',
    '.comments',
    '.related-posts'
  ];

  function getMarkdownForElement(element) {
    if (element.tagName === 'H1') {
      return `# ${element.textContent.trim()}\n\n`;
    }
    if (element.tagName === 'H2') {
      return `## ${element.textContent.trim()}\n\n`;
    }
    if (element.tagName === 'H3') {
      return `### ${element.textContent.trim()}\n\n`;
    }
    if (element.tagName === 'H4') {
      return `#### ${element.textContent.trim()}\n\n`;
    }
    if (element.tagName === 'H5') {
      return `##### ${element.textContent.trim()}\n\n`;
    }
    if (element.tagName === 'H6') {
      return `###### ${element.textContent.trim()}\n\n`;
    }
    if (element.tagName === 'P') {
      const text = element.textContent.trim();
      return text ? `${text}\n\n` : '';
    }
    if (element.tagName === 'A') {
      const text = element.textContent.trim();
      const href = element.getAttribute('href');
      return text && href ? `[${text}](${href})` : text;
    }
    if (element.tagName === 'IMG') {
      const alt = element.getAttribute('alt') || '';
      const src = element.getAttribute('src');
      return src ? `![${alt}](${src})` : '';
    }
    if (element.tagName === 'UL' || element.tagName === 'OL') {
      let items = '';
      const prefix = element.tagName === 'UL' ? '- ' : '1. ';
      element.querySelectorAll('li').forEach(li => {
        items += `${prefix} ${li.textContent.trim()}\n`;
      });
      return items ? `${items}\n` : '';
    }
    if (element.tagName === 'TABLE') {
      let markdown = '\n';
      const rows = element.querySelectorAll('tr');
      let hasHeader = element.querySelector('th') !== null;

      rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll(hasHeader && rowIndex === 0 ? 'th' : 'td');
        const rowContent = Array.from(cells)
          .map(cell => cell.textContent.trim())
          .join(' | ');
        
        markdown += `| ${rowContent} |\n`;

        // Add separator after header
        if (rowIndex === 0 && hasHeader) {
          markdown += '|' + Array(cells.length).fill('---').join('|') + '|\n';
        }
      });
      return `${markdown}\n`;
    }
    if (element.tagName === 'BLOCKQUOTE') {
      const text = element.textContent.trim();
      return text ? `> ${text}\n\n` : '';
    }
    if (element.tagName === 'CODE') {
      const text = element.textContent.trim();
      return text ? `\`${text}\`` : '';
    }
    if (element.tagName === 'PRE') {
      const text = element.textContent.trim();
      return text ? `\`\`\`\n${text}\n\`\`\`\n\n` : '';
    }

    // For other elements with meaningful text
    const text = element.textContent.trim();
    if (text && !element.querySelector('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, table')) {
      return `${text}\n\n`;
    }

    // Process child elements
    let content = '';
    element.childNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        content += getMarkdownForElement(node);
      } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        content += `${node.textContent.trim()}\n\n`;
      }
    });
    return content;
  }

  // Start with the prompt
  let markdown = prompt ? `${prompt}\n\n---\n\n` : '';

  // Get the page title
  markdown += `# ${document.title.trim()}\n\n`;

  // Get meta description if available
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) {
    const description = metaDescription.getAttribute('content');
    if (description) {
      markdown += `${description}\n\n---\n\n`;
    }
  }

  // Clone the body to work with
  const bodyClone = document.body.cloneNode(true);

  // Remove unwanted elements from the clone
  excludeSelectors.forEach(selector => {
    try {
      const elements = bodyClone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    } catch (e) {
      // Skip invalid selectors
    }
  });

  // Process the main content
  const mainContent = bodyClone.querySelector('main, article, .content, #content, [role="main"]');
  if (mainContent) {
    markdown += getMarkdownForElement(mainContent);
  } else {
    // If no main content container is found, process the body
    Array.from(bodyClone.children).forEach(child => {
      markdown += getMarkdownForElement(child);
    });
  }

  // Clean up the markdown
  markdown = markdown
    // Remove excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Remove spaces before newlines
    .replace(/[ \t]+\n/g, '\n')
    // Ensure consistent heading spacing
    .replace(/#+\s*\n/g, '')
    // Remove empty headings
    .trim();

  return markdown;
}

// Function to scrape Amazon product details
function scrapeAmazonProduct(prompt) {
  const defaultPrompt = `Extract the following fields from this Amazon product listing:

Product Title

Brand

Scent

Special Feature

Product Benefits

Seasons

About This Item

Additional Details

Ingredients

Product Details

Important Information

Present the output as a single row of data, tab-separated (or CSV format if preferred) so I can copy-paste directly into Google Sheets.

👉 Do not include header row. Only output the data row.
👉 If a field is missing, leave it empty.
👉 Join multi-line fields with ; (semicolons) to keep them in a single cell.

Here's the Amazon product listing text:`;

  // Use the provided prompt or fall back to default
  const finalPrompt = prompt || defaultPrompt;

  function getTextContent(selector) {
    const element = document.querySelector(selector);
    return element ? element.textContent.trim() : '';
  }

  function getBulletPoints(selector) {
    const container = document.querySelector(selector);
    if (!container) return '';
    const bullets = container.querySelectorAll('li');
    return Array.from(bullets).map(bullet => bullet.textContent.trim()).join('; ');
  }

  function getTableContent(selector) {
    const table = document.querySelector(selector);
    if (!table) return '';
    const rows = table.querySelectorAll('tr');
    return Array.from(rows)
      .map(row => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          return `${cells[0].textContent.trim()}: ${cells[1].textContent.trim()}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('; ');
  }

  // Extract all fields
  const fields = {
    'Product Title': getTextContent('#productTitle') || getTextContent('h1'),
    'Brand': getTextContent('#bylineInfo') || getTextContent('#brand') || getTextContent('.po-brand .a-span9'),
    'Scent': getTextContent('#scent') || getTextContent('.po-scent .a-span9'),
    'Special Feature': getBulletPoints('#feature-bullets') || getBulletPoints('#productOverview_feature_div ul'),
    'Product Benefits': getTextContent('#productBenefits') || getTextContent('.po-product_benefits .a-span9'),
    'Seasons': getTextContent('#seasons') || getTextContent('.po-seasons .a-span9'),
    'About This Item': getTextContent('#productDescription') || getTextContent('#productDescription_feature_div') || getTextContent('#aplus_feature_div'),
    'Additional Details': getTableContent('#productDetails_db_sections') || getTableContent('#important-information'),
    'Ingredients': getTextContent('#ingredients') || getTextContent('.po-ingredients .a-span9'),
    'Product Details': getTableContent('#productDetails_detailBullets_sections1') || getTableContent('#productDetails_feature_div'),
    'Important Information': getTableContent('#important-information') || getTableContent('#productDetails_db_sections')
  };

  // Create CSV row
  const csvRow = Object.values(fields)
    .map(value => {
      // Escape quotes and wrap in quotes if contains comma or newline
      const escapedValue = (value || '').replace(/"/g, '""');
      if (escapedValue.includes(',') || escapedValue.includes('\n')) {
        return `"${escapedValue}"`;
      }
      return escapedValue;
    })
    .join(',');

  return finalPrompt + '\n\n' + csvRow;
}