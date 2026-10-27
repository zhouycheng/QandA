import { Fragment } from 'react'
export function AnnouncementBody({ text }: { text: string }) {
  return (
    <div className="announcement-body">
      {text.split('\n').map((line, i) => (
        <p key={i}>
          {line
            .split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
            .map((part, j) =>
              part.startsWith('**') ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : part.startsWith('_') && part.endsWith('_') ? (
                <em key={j}>{part.slice(1, -1)}</em>
              ) : (
                <Fragment key={j}>{part || '\u00a0'}</Fragment>
              ),
            )}
        </p>
      ))}
    </div>
  )
}
