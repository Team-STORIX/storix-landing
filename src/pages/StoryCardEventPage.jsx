import { useEffect } from 'react'
import '../story-card-event.css'

export default function StoryCardEventPage() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = '스토리카드 이벤트 | STORIX'
    document.documentElement.classList.add('storyCardDocument')

    return () => {
      document.title = previousTitle
      document.documentElement.classList.remove('storyCardDocument')
    }
  }, [])

  return (
    <main className="storyCardEventPage">
      <h1>스토리카드 이벤트입니다</h1>
    </main>
  )
}
