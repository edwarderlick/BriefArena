import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LandingPage } from './pages/LandingPage';
import { ExplorePage } from './pages/ExplorePage';
import { ChallengeDetailPage } from './pages/ChallengeDetailPage';
import { SubmitEntryPage } from './pages/SubmitEntryPage';
import { DecisionPage } from './pages/DecisionPage';
import { CreateChallengePage } from './pages/CreateChallengePage';
import { MyArenaPage } from './pages/MyArenaPage';
import { HowItWorksPage } from './pages/HowItWorksPage';

// Scroll to top on route change
function ScrollToTop() {
  const { pathname } = useLocation();
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export const App: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background text-on-surface antialiased font-sans">
      <ScrollToTop />
      <Header />
      
      {/* Main container with padding for fixed header */}
      <main className="w-full pt-20 flex-1 flex flex-col">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/challenges" element={<ExplorePage />} />
          <Route path="/challenges/new" element={<CreateChallengePage />} />
          <Route path="/challenges/:id" element={<ChallengeDetailPage />} />
          <Route path="/challenges/:id/submit" element={<SubmitEntryPage />} />
          <Route path="/challenges/:id/decision" element={<DecisionPage />} />
          <Route path="/my-arena" element={<MyArenaPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer />
    </div>
  );
};

export default App;
