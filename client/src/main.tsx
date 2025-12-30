import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            <Routes>
                <Route path="/session/:sessionId" element={<App />} />
                <Route path="*" element={<App />} />
            </Routes>
        </BrowserRouter>
    </StrictMode>,
);
