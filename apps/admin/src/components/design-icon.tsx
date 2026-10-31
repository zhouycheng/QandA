import home from '../assets/figma/home.svg'
import dashboard from '../assets/figma/dashboard.svg'
import college from '../assets/figma/college.svg'
import activity from '../assets/figma/activity.svg'
import book from '../assets/figma/book.svg'
import file from '../assets/figma/file.svg'
import shield from '../assets/figma/shield.svg'
import announcement from '../assets/figma/announcement.svg'
import users from '../assets/figma/users.svg'
import user from '../assets/figma/user.svg'
import settings from '../assets/figma/settings.svg'
import statUsers from '../assets/figma/stat-users.svg'
import statSubjects from '../assets/figma/stat-subjects.svg'
import statBanks from '../assets/figma/stat-banks.svg'
import statQuestions from '../assets/figma/stat-questions.svg'
import statAnswers from '../assets/figma/stat-answers.svg'
const icons = {
  home,
  dashboard,
  college,
  activity,
  book,
  file,
  shield,
  announcement,
  users,
  user,
  settings,
  statUsers,
  statSubjects,
  statBanks,
  statQuestions,
  statAnswers,
}
export function DesignIcon({ name }: { name: keyof typeof icons }) {
  return (
    <span className="design-icon" data-icon={name} aria-hidden="true">
      <img src={icons[name]} alt="" />
    </span>
  )
}
