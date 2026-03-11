/**
 * Analytics utility for tracking website usage
 */

export async function sendAnalytics(): Promise<void> {
  try {
    // Get trafficType from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const trafficType = urlParams.get('trafficType') || 'normal';
    
    // Construct the analytics URL
    const analyticsUrl = `https://api.ashwinsi.in/personal-server/website/add-analytics?trafficType=${encodeURIComponent(trafficType)}&website=pdf`;
    
    // Send the analytics request
    await fetch(analyticsUrl, {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log(`Analytics sent: trafficType=${trafficType}`);
  } catch (error) {
    // Silently fail analytics - don't disrupt user experience
    console.warn('Analytics request failed:', error);
  }
}