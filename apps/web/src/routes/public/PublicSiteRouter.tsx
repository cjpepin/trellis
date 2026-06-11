import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { appShellPath } from "@/lib/appRoutes";
import { GuestQuotaModal } from "@/components/public/GuestQuotaModal";
import { AuthConfirmPage } from "@/routes/public/AuthConfirmPage";
import { AuthPage } from "@/routes/public/AuthPage";
import { DownloadPage } from "@/routes/public/DownloadPage";
import { ForumPage } from "@/routes/public/ForumPage";
import { LandingPage } from "@/routes/public/LandingPage";
import { NotFoundPage } from "@/routes/public/NotFoundPage";
import { PrivacyPage } from "@/routes/public/PrivacyPage";
import { SupportPage } from "@/routes/public/SupportPage";
import { TermsPage } from "@/routes/public/TermsPage";
import { UpdatePostPage } from "@/routes/public/UpdatePostPage";
import { UpdatesIndexPage } from "@/routes/public/UpdatesIndexPage";

interface Props {
  appShell: ReactNode;
}

export function PublicSiteRouter({ appShell }: Props) {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/confirm" element={<AuthConfirmPage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/updates" element={<UpdatesIndexPage />} />
        <Route path="/updates/:slug" element={<UpdatePostPage />} />
        <Route path="/forum" element={<ForumPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/chat" element={<Navigate to={appShellPath("/chat")} replace />} />
        <Route path="/thoughts" element={<Navigate to={appShellPath("/thoughts")} replace />} />
        <Route path="/notes" element={<Navigate to={appShellPath("/notes")} replace />} />
        <Route path="/wiki" element={<Navigate to={appShellPath("/notes")} replace />} />
        <Route path="/graph" element={<Navigate to={appShellPath("/graph")} replace />} />
        <Route path="/settings" element={<Navigate to={appShellPath("/settings")} replace />} />
        <Route path="/app/*" element={<>{appShell}</>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <GuestQuotaModal />
    </BrowserRouter>
  );
}
