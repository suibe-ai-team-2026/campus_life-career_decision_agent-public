import apiClient from './client'
import {
  CheckinResponse,
  CreateFlashcardDeckRequest,
  CreateFlashcardRequest,
  FlashcardDeckResponse,
  FlashcardGradeValue,
  FlashcardResponse,
  StreakStatusResponse,
  StudyMetricsResponse,
} from '@/lib/types/api'

export const genoteApi = {
  listDecks: async () => {
    const response = await apiClient.get<FlashcardDeckResponse[]>('/flashcards/decks')
    return response.data
  },

  createDeck: async (data: CreateFlashcardDeckRequest) => {
    const response = await apiClient.post<FlashcardDeckResponse>('/flashcards/decks', data)
    return response.data
  },

  listCards: async (deckId: string, dueOnly = false) => {
    const response = await apiClient.get<FlashcardResponse[]>(
      `/flashcards/decks/${encodeURIComponent(deckId)}/cards`,
      { params: { due_only: dueOnly } }
    )
    return response.data
  },

  listDueCards: async (limit = 50) => {
    const response = await apiClient.get<FlashcardResponse[]>('/flashcards/cards/due', {
      params: { limit },
    })
    return response.data
  },

  createCard: async (deckId: string, data: CreateFlashcardRequest) => {
    const response = await apiClient.post<FlashcardResponse>(
      `/flashcards/decks/${encodeURIComponent(deckId)}/cards`,
      data
    )
    return response.data
  },

  gradeCard: async (cardId: string, grade: FlashcardGradeValue) => {
    const response = await apiClient.post<FlashcardResponse>(
      `/flashcards/cards/${encodeURIComponent(cardId)}/grade`,
      { grade }
    )
    return response.data
  },

  getStreak: async () => {
    const response = await apiClient.get<StreakStatusResponse>('/study/streak')
    return response.data
  },

  checkin: async () => {
    const response = await apiClient.post<CheckinResponse>('/study/checkin')
    return response.data
  },

  getMetrics: async () => {
    const response = await apiClient.get<StudyMetricsResponse>('/study/metrics')
    return response.data
  },
}
