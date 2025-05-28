document.addEventListener('DOMContentLoaded', function() {
  const amazonImagesBtn = document.getElementById('amazonImagesBtn');
  const replaceImageBtn = document.getElementById('replaceImageBtn');
  const productUrl = document.getElementById('productUrl');
  const productDetailUrl = document.getElementById('productDetailUrl');
  const rankInput = document.getElementById('rankInput');
  const statusDiv = document.getElementById('status');

  // Load saved values on popup open
  chrome.storage.local.get(['productUrl', 'productDetailUrl', 'rank'], function(result) {
    if (result.productUrl) {
      productUrl.value = result.productUrl;
    }
    if (result.productDetailUrl) {
      productDetailUrl.value = result.productDetailUrl;
    }
    if (result.rank) {
      rankInput.value = result.rank;
    }
  });

  // Save values when they change
  productUrl.addEventListener('change', () => {
    chrome.storage.local.set({ productUrl: productUrl.value });
  });

  productDetailUrl.addEventListener('change', () => {
    chrome.storage.local.set({ productDetailUrl: productDetailUrl.value });
  });

  rankInput.addEventListener('change', () => {
    chrome.storage.local.set({ rank: rankInput.value });
  });

  amazonImagesBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: extractAmazonImages
      });

      if (result && result[0] && result[0].result) {
        const imageLinks = result[0].result;
        await navigator.clipboard.writeText(imageLinks.join('\n'));
        showStatus('Product image links copied to clipboard!', 'success');
      } else {
        throw new Error('Failed to extract product images');
      }
    } catch (error) {
      showStatus('Error: ' + error.message, 'error');
    }
  });

  replaceImageBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const imageUrl = productDetailUrl.value.trim();
      const rank = parseInt(rankInput.value);

      if (!imageUrl) {
        showStatus('Please enter an image URL', 'error');
        return;
      }

      if (!rank || rank < 1) {
        showStatus('Please enter a valid rank number', 'error');
        return;
      }

      // If product URL is provided, fetch the title
      let title = 'Product Title';
      if (productUrl.value.trim()) {
        const productDetails = await fetchProductDetails(productUrl.value.trim());
        if (productDetails && productDetails.title) {
          title = productDetails.title;
        }
      }

      const productDetails = {
        title: title,
        imageUrl: imageUrl
      };

      // Then, replace the product in search results
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: replaceProductInSearch,
        args: [productDetails, rank]
      });

      if (result && result[0] && result[0].result) {
        showStatus('Product replaced successfully!', 'success');
      } else {
        throw new Error('Failed to replace product');
      }
    } catch (error) {
      showStatus('Error: ' + error.message, 'error');
    }
  });

  async function fetchProductDetails(url) {
    try {
      const response = await fetch(url);
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract product title
      const title = doc.querySelector('#productTitle')?.textContent.trim() || '';
      console.log('Found title:', title);
      
      return { title };
    } catch (error) {
      console.error('Error fetching product details:', error);
      return null;
    }
  }

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
});

function extractAmazonImages() {
  // Check if we're on an Amazon product page
  if (!window.location.hostname.includes('amazon.')) {
    throw new Error('Please navigate to an Amazon product page');
  }

  // Try immersive view first
  const immersiveThumbs = document.querySelectorAll('#ivThumbs .ivThumbImage');
  const imageLinks = new Set();

  immersiveThumbs.forEach(div => {
    const bg = div.style.background;
    // Extract the URL from background: url("...")
    const match = bg.match(/url\(["']?(.*?)["']?\)/);
    if (match && match[1]) {
      // Convert to full-size if needed
      const url = match[1].replace(/\._[^.]+_\./, '.');
      imageLinks.add(url);
    }
  });

  // Fallback: main image block
  if (imageLinks.size === 0) {
    // Try to find the main image container
    const mainImageContainer =
      document.querySelector('#main-image-container') ||
      document.querySelector('#imageBlock') ||
      document.querySelector('#imgTagWrapperId') ||
      document.querySelector('.imageBlock');
    if (mainImageContainer) {
      const images = mainImageContainer.querySelectorAll('img');
      images.forEach(img => {
        if (img.src) {
          const fullSizeUrl = img.src.replace(/\._[^.]+_\./, '.');
          imageLinks.add(fullSizeUrl);
        }
      });
    }
  }

  return Array.from(imageLinks).filter(url =>
    url &&
    url.startsWith('http') &&
    !url.includes('sprite') &&
    !url.includes('spinner')
  );
}

function replaceProductInSearch(productDetails, rank) {
  // Check if we're on an Amazon search results page
  if (!window.location.hostname.includes('amazon.') || !window.location.pathname.includes('/s')) {
    throw new Error('Please navigate to an Amazon search results page');
  }

  // Validate product details
  if (!productDetails || !productDetails.imageUrl) {
    throw new Error('Invalid product details: missing image URL');
  }

  // Find all product containers
  const productContainers = document.querySelectorAll('.s-result-item[data-component-type="s-search-result"]');
  if (productContainers.length < rank) {
    throw new Error(`Rank ${rank} is out of range. Only ${productContainers.length} products found.`);
  }

  // Get the target product container (rank is 1-based)
  const targetContainer = productContainers[rank - 1];
  if (!targetContainer) {
    throw new Error(`Could not find product at rank ${rank}`);
  }

  // Replace the image
  const productImage = targetContainer.querySelector('.s-image');
  if (!productImage) {
    throw new Error('Could not find product image element');
  }

  try {
    // Set both src and srcset attributes
    productImage.setAttribute('src', productDetails.imageUrl);
    productImage.setAttribute('srcset', productDetails.imageUrl);
  } catch (error) {
    console.error('Error replacing image:', error);
    throw new Error('Failed to replace image attributes');
  }

  // Replace the title - try multiple selectors to ensure we find the title element
  const titleSelectors = [
    'h2 .a-link-normal',
    '.a-size-medium.a-color-base.a-text-normal',
    '.a-size-base-plus.a-color-base.a-text-normal',
    '.a-size-mini .a-link-normal',
    '.a-size-mini .a-text-normal'
  ];

  let titleElement = null;
  for (const selector of titleSelectors) {
    titleElement = targetContainer.querySelector(selector);
    if (titleElement) break;
  }

  if (titleElement) {
    // Store the original title for reference
    titleElement.dataset.originalTitle = titleElement.textContent;
    // Just update the text content, preserving all CSS and structure
    titleElement.textContent = "Viva Earth " + productDetails.title;
  } else {
    console.warn('Could not find title element to replace');
  }

  return true;
} 