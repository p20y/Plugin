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
        if (imageLinks.length === 0) {
          showStatus('No product images found. Make sure you are on an Amazon product detail page.', 'error');
          return;
        }
        
        await navigator.clipboard.writeText(imageLinks.join('\n'));
        showStatus(`Successfully copied ${imageLinks.length} product image links to clipboard!`, 'success');
        
        // Log the found images for debugging
        console.log('Found images:', imageLinks);
      } else {
        throw new Error('Failed to extract product images');
      }
    } catch (error) {
      showStatus('Error: ' + error.message, 'error');
      console.error('Error extracting images:', error);
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

  const imageLinks = new Set();

  // Focus on the main displayed product images in the image block
  const imageBlock = document.querySelector('#imageBlock');
  if (!imageBlock) {
    throw new Error('Product image block not found');
  }

  // Method 1: Get the main displayed images from the main image container
  const mainImageContainer = imageBlock.querySelector('#main-image-container');
  if (mainImageContainer) {
    // Get all visible main images (the ones that are actually displayed)
    const mainImages = mainImageContainer.querySelectorAll('.image.item img, #landingImage');
    mainImages.forEach(img => {
      if (img.src && img.offsetParent !== null) { // Check if image is visible
        let fullSizeUrl = img.src;
        
        // Get the highest quality version from data-old-hires if available
        const oldHires = img.getAttribute('data-old-hires');
        if (oldHires) {
          fullSizeUrl = oldHires;
        }
        
        imageLinks.add(fullSizeUrl);
      }
    });
  }

  // Method 2: Get images from the thumbnail gallery (these represent the actual product images)
  const altImages = imageBlock.querySelector('#altImages');
  if (altImages) {
    const thumbnailImages = altImages.querySelectorAll('.imageThumbnail img');
    thumbnailImages.forEach(img => {
      if (img.src) {
        // Convert thumbnail URLs to full-size versions
        let fullSizeUrl = img.src;
        
        // Remove the _SS40_ suffix to get the original image
        if (fullSizeUrl.includes('_SS40_')) {
          fullSizeUrl = fullSizeUrl.replace('_SS40_', '');
        }
        
        imageLinks.add(fullSizeUrl);
      }
    });
  }

  // Method 3: Get the dynamic image data from the main image (contains all available sizes)
  const landingImage = imageBlock.querySelector('#landingImage');
  if (landingImage) {
    const dynamicImageData = landingImage.getAttribute('data-a-dynamic-image');
    if (dynamicImageData) {
      try {
        const imageData = JSON.parse(dynamicImageData);
        // Get the highest resolution version (usually the last one in the object)
        const urls = Object.keys(imageData);
        if (urls.length > 0) {
          // Sort by resolution and get the highest
          const sortedUrls = urls.sort((a, b) => {
            const aSize = imageData[a][0] || 0;
            const bSize = imageData[b][0] || 0;
            return bSize - aSize;
          });
          imageLinks.add(sortedUrls[0]); // Add the highest resolution version
        }
      } catch (e) {
        // If JSON parsing fails, just use the src
        if (landingImage.src) {
          imageLinks.add(landingImage.src);
        }
      }
    } else if (landingImage.src) {
      // Fallback to src if no dynamic data
      imageLinks.add(landingImage.src);
    }
  }

  // Convert Set to Array and filter
  const filteredImages = Array.from(imageLinks).filter(url =>
    url &&
    url.startsWith('http') &&
    !url.includes('sprite') &&
    !url.includes('spinner') &&
    !url.includes('transparent') &&
    !url.includes('grey-pixel') &&
    !url.includes('360_icon') &&
    (url.includes('images-na.ssl-images-amazon.com') || url.includes('m.media-amazon.com'))
  );

  // Remove duplicates and return unique product images
  return [...new Set(filteredImages)];
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