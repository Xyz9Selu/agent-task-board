import { Navigate, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { ContactPage } from './pages/ContactPage'
import { Home } from './pages/Home'
import './App.css'

/**
 * Router shell. `<Header />` is rendered above the routed page; unknown
 * routes redirect to `/`.
 */
function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}

export default App