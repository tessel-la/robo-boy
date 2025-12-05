import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import anime from 'animejs'
import { animateLandingPage, animateAdvancedForm, animateButtonPress } from './animations'

// Mock anime.js
vi.mock('animejs', () => ({
  default: vi.fn(() => ({
    finished: Promise.resolve(),
  })),
}))

describe('animations', () => {
  let mockAnime: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockAnime = anime as unknown as ReturnType<typeof vi.fn>
    mockAnime.mockClear()
  })

  describe('animateLandingPage', () => {
    it('should return early if containerRef is null', () => {
      animateLandingPage(null, null)
      expect(mockAnime).not.toHaveBeenCalled()
    })

    it('should animate entry section if found', () => {
      const mockEntrySection = document.createElement('div')
      mockEntrySection.className = 'entry-section'
      const mockContainer = document.createElement('div')
      mockContainer.appendChild(mockEntrySection)

      animateLandingPage(mockContainer, null)

      expect(mockAnime).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: mockEntrySection,
          opacity: [0, 1],
          translateY: [20, 0],
          easing: 'easeOutQuad',
          duration: 800,
        })
      )
    })

    it('should animate logo if logoRef is provided', () => {
      const mockContainer = document.createElement('div')
      const mockLogo = document.createElement('div')

      animateLandingPage(mockContainer, mockLogo)

      expect(mockAnime).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: mockLogo,
          opacity: [0, 1],
          translateY: [-20, 0],
          easing: 'easeOutExpo',
          duration: 1000,
          delay: 200,
        })
      )
    })

    it('should animate both entry section and logo', () => {
      const mockEntrySection = document.createElement('div')
      mockEntrySection.className = 'entry-section'
      const mockContainer = document.createElement('div')
      mockContainer.appendChild(mockEntrySection)
      const mockLogo = document.createElement('div')

      animateLandingPage(mockContainer, mockLogo)

      expect(mockAnime).toHaveBeenCalledTimes(2)
    })
  })

  describe('animateAdvancedForm', () => {
    it('should return early if formRef is null', () => {
      animateAdvancedForm(null, true)
      expect(mockAnime).not.toHaveBeenCalled()
    })

    it('should add visible class and animate opacity when isVisible is true', () => {
      const mockForm = document.createElement('div')

      animateAdvancedForm(mockForm, true)

      expect(mockForm.classList.contains('visible')).toBe(true)
      expect(mockAnime).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: mockForm,
          opacity: [0, 1],
          duration: 500,
          easing: 'easeOutQuad',
        })
      )
    })

    it('should animate opacity to 0 when isVisible is false', () => {
      const mockForm = document.createElement('div')
      mockForm.classList.add('visible')

      animateAdvancedForm(mockForm, false)

      expect(mockAnime).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: mockForm,
          opacity: 0,
          duration: 300,
          easing: 'easeOutQuad',
        })
      )
    })

    it('should remove visible class on animation complete when hiding', () => {
      const mockForm = document.createElement('div')
      mockForm.classList.add('visible')

      // Capture the complete callback
      let completeCallback: (() => void) | undefined
      mockAnime.mockImplementation((params: { complete?: () => void }) => {
        completeCallback = params.complete
        return { finished: Promise.resolve() }
      })

      animateAdvancedForm(mockForm, false)

      // Simulate animation complete
      if (completeCallback) {
        completeCallback()
      }

      expect(mockForm.classList.contains('visible')).toBe(false)
    })
  })

  describe('animateButtonPress', () => {
    it('should return early if element is null', () => {
      animateButtonPress(null)
      expect(mockAnime).not.toHaveBeenCalled()
    })

    it('should animate button with scale effect', () => {
      const mockButton = document.createElement('button')

      animateButtonPress(mockButton)

      expect(mockAnime).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: mockButton,
          scale: [1, 0.95, 1],
          duration: 300,
          easing: 'easeInOutQuad',
        })
      )
    })
  })
})

