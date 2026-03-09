# PDF Studio - All-in-One PDF Editor

PDF Studio is a unified, single-page web application that allows you to perform multiple PDF operations--such as splitting, rearranging, compressing, and converting--entirely within your browser. By utilizing client-side processing, your files remain completely private and secure.

## Features

- **Split PDF:** Extract specific pages or divide your PDF into multiple documents.
- **Compress PDF:** Reduce the file size of your PDF documents for easier sharing via email or web.
- **Convert PDF:** Seamlessly convert your PDF pages to high-quality PNG, JPG, or extract text (TXT).
- **Image to PDF:** Combine multiple JPG or PNG images into a single, cohesive PDF document.
- **Rearrange & Manage Pages:** Drag and drop pages to reorder them, delete unwanted pages, and rotate individual pages.
- **Merge PDFs:** Upload multiple PDF files simultaneously to combine them into one document.
- **Dark Mode & Light Mode:** A visually stunning UI that adapts to your preferred system theme.
- **Mobile Responsive:** A highly optimized layout with a bottom navigation bar for mobile devices.
- **Fully Client-Side:** All processing happens locally in your browser using WebAssembly and JavaScript—no server uploads required.

## Tech Stack

- React (TypeScript)
- Vite
- pdf-lib (for PDF manipulation)
- pdfjs-dist (for PDF rendering/viewing)
- @dnd-kit (for robust drag-and-drop interactions)
- Lucide React (for UI iconography)

## Getting Started

Follow these instructions to set up and run the project on your local machine.

### Prerequisites

Ensure you have Node.js and npm installed on your system.

### Installation

1. Clone the repository:
   git clone <your-repository-url>

2. Navigate into the project directory:
   cd pdf_all

3. Install the application dependencies:
   npm install

### Running the Application

To start the local development server:

npm run dev

Once the server starts, open your browser and navigate to the provided localhost URL (typically http://localhost:5173).

### Building for Production

To create an optimized production build:

npm run build

The built assets will be generated in the `dist` directory, ready to be deployed to your preferred hosting platform.

## Developer Credits

Built by Ashwin S I.
