document.addEventListener('DOMContentLoaded', function() {
  const amazonImagesBtn = document.getElementById('amazonImagesBtn');
  const replaceImageBtn = document.getElementById('replaceImageBtn');
  const productDetailUrl = document.getElementById('productDetailUrl');
  const rankInput = document.getElementById('rankInput');
  const statusDiv = document.getElementById('status');

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
      
      const detailUrl = productDetailUrl.value.trim();
      const rank = parseInt(rankInput.value);

      if (!detailUrl) {
        showStatus('Please enter a product detail page URL', 'error');
        return;
      }

      if (!rank || rank < 1) {
        showStatus('Please enter a valid rank number', 'error');
        return;
      }

      // First, fetch product details from the detail page
      const productDetails = await fetchProductDetails(detailUrl);
      if (!productDetails) {
        throw new Error('Failed to fetch product details');
      }

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
      
      // Extract main image URL
      const mainImage = doc.querySelector('#landingImage');
      let imageUrl = '';
      if (mainImage) {
        // Get the highest quality image URL
        imageUrl = mainImage.src.replace(/\._[^.]+_\./, '.');
      }

      return { title, imageUrl };
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

  // Get all product images
  const imageLinks = new Set();
  
  // Main product image
  const mainImage = document.querySelector('#landingImage');
  if (mainImage && mainImage.src) {
    imageLinks.add(mainImage.src);
  }

  // Thumbnail images
  const thumbnails = document.querySelectorAll('#imageThumbs img, #imageBlock img');
  thumbnails.forEach(img => {
    if (img.src) {
      // Convert thumbnail URL to full-size image URL
      const fullSizeUrl = img.src.replace(/\._[^.]+_\./, '.');
      imageLinks.add(fullSizeUrl);
    }
  });

  // Additional images from the image gallery
  const galleryImages = document.querySelectorAll('#imageBlock img, #imageGallery img');
  galleryImages.forEach(img => {
    if (img.src) {
      const fullSizeUrl = img.src.replace(/\._[^.]+_\./, '.');
      imageLinks.add(fullSizeUrl);
    }
  });

  // Convert Set to Array and filter out any invalid URLs
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

  // Find all product containers
  const productContainers = document.querySelectorAll('.s-result-item[data-component-type="s-search-result"]');
  if (productContainers.length < rank) {
    throw new Error(`Not enough products found on the page (found ${productContainers.length}, requested rank ${rank})`);
  }

  // Get the target product container (rank is 1-based)
  const targetContainer = productContainers[rank - 1];
  if (!targetContainer) {
    throw new Error(`Could not find product at rank ${rank}`);
  }

  // Replace the image
  const productImage = targetContainer.querySelector('.s-image');
  if (productImage) {
    productImage.src = productDetails.imageUrl;
    productImage.srcset = ''; // Clear srcset to prevent responsive image loading
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
    
    // Create a new text node with the prefixed title
    const newTitle = "Viva Earth " + productDetails.title;
    
    // If the title is in a link, update the link's text content
    const linkElement = titleElement.closest('a');
    if (linkElement) {
      // Preserve all child elements and attributes
      const originalHTML = linkElement.innerHTML;
      const originalClasses = linkElement.className;
      const originalAttributes = Array.from(linkElement.attributes)
        .filter(attr => attr.name !== 'class')
        .reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {});

      // Create a new link with the same structure
      const newLink = document.createElement('a');
      newLink.className = originalClasses;
      Object.entries(originalAttributes).forEach(([name, value]) => {
        newLink.setAttribute(name, value);
      });
      newLink.textContent = newTitle;

      // Replace the old link with the new one
      linkElement.parentNode.replaceChild(newLink, linkElement);
    } else {
      // If not in a link, just update the text content
      titleElement.textContent = newTitle;
    }
  } else {
    console.warn('Could not find title element to replace');
  }

  return true;
} 