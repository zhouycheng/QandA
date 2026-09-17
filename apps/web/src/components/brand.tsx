import brandMark from '../assets/qanda-brand-mark.svg'

export function Brand() {
  return (
    <span className="brand" aria-label="QandA">
      <img src={brandMark} alt="" aria-hidden="true" />
      <span>QandA</span>
    </span>
  )
}
