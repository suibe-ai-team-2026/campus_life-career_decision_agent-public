import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { genoteApi } from '@/lib/api/genote'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { FlashcardGradeValue } from '@/lib/types/api'

export function useFlashcardDecks() {
  return useQuery({
    queryKey: QUERY_KEYS.flashcardDecks,
    queryFn: genoteApi.listDecks,
  })
}

export function useDueFlashcards(limit = 50) {
  return useQuery({
    queryKey: [...QUERY_KEYS.dueFlashcards, limit],
    queryFn: () => genoteApi.listDueCards(limit),
  })
}

export function useGradeFlashcard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ cardId, grade }: { cardId: string; grade: FlashcardGradeValue }) =>
      genoteApi.gradeCard(cardId, grade),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dueFlashcards })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.flashcardDecks })
    },
    onError: () => {
      toast.error('评分保存失败，请稍后重试')
    },
  })
}

export function useStudyStreak() {
  return useQuery({
    queryKey: QUERY_KEYS.studyStreak,
    queryFn: genoteApi.getStreak,
  })
}

export function useCheckin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: genoteApi.checkin,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.studyStreak })
      toast.success(data.message)
    },
    onError: () => {
      toast.error('签到失败，请稍后重试')
    },
  })
}

export function useStudyMetrics() {
  return useQuery({
    queryKey: QUERY_KEYS.studyMetrics,
    queryFn: genoteApi.getMetrics,
  })
}
