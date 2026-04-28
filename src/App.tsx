import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Dashboard } from './pages/Dashboard'
import { Deals } from './pages/Deals'
import { Companies } from './pages/Companies'
import { CompanyDetail } from './pages/CompanyDetail'
import { Contacts } from './pages/Contacts'
import { ContactDetail } from './pages/ContactDetail'
import { DealDetail } from './pages/DealDetail'
import { Tasks } from './pages/Tasks'
import { ExecUpdates } from './pages/ExecUpdates'
import { Import } from './pages/Import'
import { Settings } from './pages/Settings'
import { Sequences } from './pages/Sequences'
import { SequenceEditor } from './pages/SequenceEditor'
import { SequenceEnrollments } from './pages/SequenceEnrollments'
import { Templates } from './pages/Templates'
import { Engagement } from './pages/Engagement'
import { BookingLinks } from './pages/BookingLinks'
import { BookingLinkEditor } from './pages/BookingLinkEditor'
import { PublicBooking } from './pages/PublicBooking'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      {/* Public booking page — no AppShell, no auth */}
      <Route path="/book/:slug" element={<PublicBooking />} />

      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="/deals" element={<Deals />} />
        <Route path="/deals/:id" element={<DealDetail />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/companies/:id" element={<CompanyDetail />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/sequences" element={<Sequences />} />
        <Route path="/sequences/:id" element={<SequenceEditor />} />
        <Route path="/sequences/:id/enrollments" element={<SequenceEnrollments />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/engagement" element={<Engagement />} />
        <Route path="/scheduling" element={<BookingLinks />} />
        <Route path="/scheduling/:id" element={<BookingLinkEditor />} />
        <Route path="/exec" element={<ExecUpdates />} />
        <Route path="/import" element={<Import />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
