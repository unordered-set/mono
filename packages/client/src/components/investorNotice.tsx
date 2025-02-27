import {useState} from "react"
import {iconCarrotDown, iconCarrotUp, iconInfo} from "./icons"

export default function InvestorNotice() {
  const [open, setOpen] = useState<boolean>(false)

  return (
    <div className="investor-notice info-banner subtle background-container" onClick={() => setOpen(!open)}>
      <div className="inner-banner">
        <div className="message">
          {iconInfo}
          <p>This offering is only available to non-U.S. persons.</p>
        </div>
        {open ? (
          <button className="expand close">{iconCarrotUp}</button>
        ) : (
          <button className="expand open">{iconCarrotDown}</button>
        )}
      </div>
      <div className={`hidden-message ${open ? "show" : "hide"}`}>
        This offering is only available to non-U.S. persons. This offering has not been registered under the U.S.
        Securities Act of 1933 (“Securities Act”), as amended, and may not be offered or sold in the United States or to
        a U.S. person (as defined in Regulation S promulgated under the Securities Act) absent registration or an
        applicable exemption from the registration requirements.
      </div>
    </div>
  )
}
